#include "httplib.h"
#include "json.hpp"
#include <iostream>
#include <fstream>
#include <string>
#include <future>
#include <vector>
#include <map>
#include <mutex>
#include <thread>
#include <chrono>

using json = nlohmann::json;

struct Agent {
    std::string name;
    int port;
    int read_timeout_secs;
    int max_tokens;
    std::string system_prompt;
    std::string backend;
    std::string engine; // "llama" (default), "mlx", or "docker"
    std::string model;  // model ID — sent in request body for docker/vllm
};

std::vector<Agent> agents;

// mlx-lm does not support concurrent requests on the same port.
// Serialize all calls to mlx ports via a per-port mutex.
static std::map<int, std::unique_ptr<std::mutex>> mlx_port_locks;

static std::vector<json> history;
static std::mutex history_mutex;
static std::string history_path;

static std::string call_agent(const Agent& agent, const std::string& prompt) {
    // Serialize requests to mlx-lm servers — they crash on concurrent batch prompts
    std::unique_lock<std::mutex> mlx_lock;
    if (agent.engine == "mlx") {
        auto it = mlx_port_locks.find(agent.port);
        if (it != mlx_port_locks.end()) {
            mlx_lock = std::unique_lock<std::mutex>(*it->second);
        }
    }

    try {
        httplib::Client cli("127.0.0.1", agent.port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(agent.read_timeout_secs);

        json messages = json::array();
        // mlx-lm often rejects "system" role — merge into first user message instead.
        if (agent.engine == "mlx" && !agent.system_prompt.empty()) {
            messages.push_back({{"role", "user"}, {"content", agent.system_prompt + "\n\n" + prompt}});
        } else {
            if (!agent.system_prompt.empty())
                messages.push_back({{"role", "system"}, {"content", agent.system_prompt}});
            messages.push_back({{"role", "user"}, {"content", prompt}});
        }

        json body = {
            {"messages", messages},
            {"max_tokens", agent.max_tokens}
        };
        // Docker Model Runner, docker-vllm, and vLLM require the model name in the request body
        if (!agent.model.empty() && (agent.backend == "docker" || agent.backend == "vllm"
                                     || agent.backend == "docker-vllm")) {
            body["model"] = agent.model;
        }

        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");

        std::string result;
        if (res && res->status == 200) {
            auto j = json::parse(res->body);
            if (j.contains("choices") && !j["choices"].empty()) {
                result = j["choices"][0]["message"]["content"];
            }
        } else if (res) {
            try {
                auto err = json::parse(res->body);
                if (err.contains("error") && err["error"].contains("message")) {
                    result = "[" + agent.name + " error] " + err["error"]["message"].get<std::string>();
                }
            } catch (...) {
                std::cerr << "[coordinator] Non-JSON error body from " << agent.name
                          << " (status " << res->status << ")" << std::endl;
            }
        }
        if (result.empty()) {
            result = "Agent " + agent.name + " (Port " + std::to_string(agent.port) + ") is not responding.";
        }
        // Drain delay: let mlx-lm's KV cache reset before next serialized request.
        if (agent.engine == "mlx") {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
        return result;

    } catch (const std::exception& e) {
        std::cerr << "[coordinator] call_agent exception for " << agent.name
                  << ": " << e.what() << std::endl;
        return "Connection Error (" + agent.name + "): " + std::string(e.what());
    }
}

/** Parallel broadcast: every agent receives the same user prompt (no staged pipeline). */
static json run_parallel_swarm(const std::vector<Agent>& all, const std::string& user_prompt) {
    json response_json;
    std::cout << "🔀 Broadcasting to " << all.size() << " agent(s) in parallel..." << std::endl;

    std::vector<std::future<std::pair<std::string, std::string>>> futures;
    for (const auto& agent : all) {
        futures.push_back(std::async(std::launch::async, [user_prompt, agent]() {
            return std::make_pair(agent.name, call_agent(agent, user_prompt));
        }));
    }

    for (auto& fut : futures) {
        auto pair = fut.get();
        response_json[pair.first] = pair.second;
    }

    return response_json;
}

void load_history() {
    std::ifstream f(history_path);
    if (!f.is_open()) return;
    try {
        json arr = json::parse(f);
        if (arr.is_array()) history = arr.get<std::vector<json>>();
    } catch (const std::exception& e) {
        std::cerr << "❌ Failed to parse history: " << e.what() << std::endl;
    }
}

void save_history() {
    std::ofstream f(history_path);
    if (!f.is_open()) {
        std::cerr << "❌ Failed to open history file for writing: " << history_path << std::endl;
        return;
    }
    f << json(history).dump(2);
}

int main(int argc, char* argv[]) {
    std::string config_path = "swarm-config.json";
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            config_path = argv[i + 1];
            i++;
        }
    }

    history_path = config_path.substr(0, config_path.rfind('/') + 1) + "history.json";
    if (history_path == "history.json") history_path = "history.json";

    std::ifstream config_file(config_path);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << config_path << std::endl;
        return 1;
    }
    json config = json::parse(config_file);
    for (auto& a : config["agents"]) {
        // "engine" takes priority; fall back to "backend" so configs using
        // backend:"mlx" also get serialized without needing an "engine" key.
        std::string backend_val = a.contains("backend") ? a["backend"].get<std::string>() : "";
        std::string engine = a.contains("engine") ? a["engine"].get<std::string>()
                             : (backend_val == "mlx" ? "mlx"
                               : backend_val == "docker" ? "docker" : "llama");
        agents.push_back({
            a["name"].get<std::string>(),
            a["port"].get<int>(),
            a["read_timeout_secs"].get<int>(),
            a["max_tokens"].get<int>(),
            a["system_prompt"].get<std::string>(),
            backend_val,
            engine,
            a.value("model", "")
        });
        if (engine == "mlx" && mlx_port_locks.find(a["port"].get<int>()) == mlx_port_locks.end()) {
            mlx_port_locks[a["port"].get<int>()] = std::make_unique<std::mutex>();
        }
    }
    std::cout << "✅ Loaded " << agents.size() << " agents from " << config_path << std::endl;

    load_history();
    std::cout << "📜 Loaded " << history.size() << " history entries from " << history_path << std::endl;

    httplib::Server svr;

    // 1. Health
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("{\"status\":\"ok\",\"engine\":\"swarm-matrix\"}", "application/json");
    });

    // 2. Agent list
    svr.Get("/api/agents", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json list = json::array();
        for (const auto& a : agents) {
            json obj = {{"name", a.name}, {"port", a.port}, {"engine", a.engine}};
            if (!a.backend.empty()) obj["backend"] = a.backend;
            list.push_back(obj);
        }
        res.set_content(list.dump(), "application/json");
    });

    // 3. History
    svr.Get("/api/history", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lock(history_mutex);
        res.set_content(json(history).dump(), "application/json");
    });

    // 4. Parallel swarm broadcast
    svr.Post("/api/architect", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🚀 [Swarm Matrix] Incoming broadcast" << std::endl;
        try {
            auto j_body = json::parse(req.body);
            std::string user_prompt = j_body.value("prompt", "");
            double temperature = j_body.value("temperature", 0.7);
            std::cout << "📝 Prompt: " << user_prompt << std::endl;

            json response_json = run_parallel_swarm(agents, user_prompt);

            auto now = std::chrono::system_clock::now();
            auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                now.time_since_epoch()).count();
            json entry = response_json;
            entry["prompt"] = user_prompt;
            entry["temperature"] = temperature;
            entry["timestamp"] = ms;

            {
                std::lock_guard<std::mutex> lock(history_mutex);
                history.push_back(entry);
                save_history();
            }

            res.set_content(response_json.dump(), "application/json");
            std::cout << "✅ [Swarm Matrix] Response sent" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [Swarm Matrix] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });

    // 5. Clear KV cache on all llama-server slots
    svr.Post("/api/clear-cache", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [Swarm Matrix] Clearing KV cache on all agents..." << std::endl;

        std::map<int, int> port_slots;
        for (const auto& a : agents) port_slots[a.port]++;

        std::vector<std::future<std::pair<int, std::string>>> futures;
        for (const auto& kv : port_slots) {
            int port = kv.first;
            int slot_count = kv.second;
            futures.push_back(std::async(std::launch::async, [port, slot_count]() {
                std::string result;
                try {
                    httplib::Client cli("127.0.0.1", port);
                    cli.set_connection_timeout(5);
                    cli.set_read_timeout(10);
                    bool all_ok = true;
                    for (int s = 0; s < slot_count; ++s) {
                        auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase",
                                         "", "application/json");
                        if (!r || r->status != 200) all_ok = false;
                    }
                    result = all_ok ? "cleared" : "partial";
                } catch (const std::exception& e) {
                    std::cerr << "❌ KV clear error on port " << port
                              << ": " << e.what() << std::endl;
                    result = std::string("error: ") + e.what();
                }
                return std::make_pair(port, result);
            }));
        }

        std::map<int, std::string> port_results;
        for (auto& fut : futures) {
            auto pr = fut.get();
            port_results[pr.first] = pr.second;
            std::cout << "  port " << pr.first << ": " << pr.second << std::endl;
        }
        json results;
        for (const auto& a : agents) results[a.name] = port_results[a.port];

        res.set_content(results.dump(), "application/json");
        std::cout << "✅ [Swarm Matrix] KV cache clear complete" << std::endl;
    });

    // 6. CORS preflight
    svr.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    std::cout << "========================================" << std::endl;
    std::cout << "🌐 Swarm Matrix coordinator ONLINE (port 8000)" << std::endl;
    std::cout << "========================================" << std::endl;

    svr.listen("0.0.0.0", 8000);
    return 0;
}
