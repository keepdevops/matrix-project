#include "httplib.h"
#include "json.hpp"
#include <iostream>
#include <fstream>
#include <string>
#include <future>
#include <vector>
#include <algorithm>
#include <map>

using json = nlohmann::json;

struct Agent {
    std::string name;
    int port;
    int read_timeout_secs;
    int max_tokens;
    std::string system_prompt;
};

std::vector<Agent> agents; // loaded from swarm-config.json at startup

std::string call_agent(const Agent& agent, const std::string& user_prompt) {
    try {
        httplib::Client cli("127.0.0.1", agent.port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(agent.read_timeout_secs);

        json body = {
            {"messages", json::array({
                {{"role", "system"}, {"content", agent.system_prompt}},
                {{"role", "user"},   {"content", user_prompt}}
            })},
            {"max_tokens", agent.max_tokens}
        };
        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");

        if (res && res->status == 200) {
            auto j = json::parse(res->body);
            if (j.contains("choices") && !j["choices"].empty()) {
                return j["choices"][0]["message"]["content"];
            }
        }
        if (res) {
            try {
                auto err = json::parse(res->body);
                if (err.contains("error") && err["error"].contains("message")) {
                    return "[" + agent.name + " error] " + err["error"]["message"].get<std::string>();
                }
            } catch (...) {}
        }
        return "Agent " + agent.name + " (Port " + std::to_string(agent.port) + ") is not responding.";
    } catch (const std::exception& e) {
        return "Connection Error (" + agent.name + "): " + std::string(e.what());
    }
}

int main(int argc, char* argv[]) {
    // Parse arguments
    std::string config_path = "swarm-config.json";
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            config_path = argv[i + 1];
            i++;
        }
    }

    // Load agents from config
    std::ifstream config_file(config_path);
    if (!config_file.is_open()) {
        std::cerr << "❌ Could not open " << config_path << std::endl;
        return 1;
    }
    json config = json::parse(config_file);
    for (auto& a : config["agents"]) {
        agents.push_back({
            a["name"].get<std::string>(),
            a["port"].get<int>(),
            a["read_timeout_secs"].get<int>(),
            a["max_tokens"].get<int>(),
            a["system_prompt"].get<std::string>()
        });
    }
    std::cout << "✅ Loaded " << agents.size() << " agents from " << config_path << std::endl;

    httplib::Server svr;

    // 1. Health Route (Fixes the "Proxy Unreachable" error)
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("{\"status\":\"ok\",\"engine\":\"matrix-m3\"}", "application/json");
        std::cout << "🩺 [M3] Health Check: 200 OK" << std::endl;
    });

    // 2. Active agents list
    svr.Get("/api/agents", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json list = json::array();
        for (const auto& a : agents) {
            list.push_back({{"name", a.name}, {"port", a.port}});
        }
        res.set_content(list.dump(), "application/json");
    });

    // 3. History Route (Fixes the 404 in the sidebar)
    svr.Get("/api/history", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("[]", "application/json");
        std::cout << "📜 [M3] History Requested" << std::endl;
    });

    // 3. Main Architect POST Route
    svr.Post("/api/architect", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🚀 [M3] Incoming Architect Request" << std::endl;

        try {
            auto j_body = json::parse(req.body);
            std::string user_prompt = j_body.value("prompt", "");
            
            std::cout << "📝 Prompt: " << user_prompt << std::endl;

            std::vector<std::future<std::pair<std::string, std::string>>> futures;
            for (const auto& agent : agents) {
                futures.push_back(std::async(std::launch::async, [user_prompt, agent]() {
                    return std::make_pair(agent.name, call_agent(agent, user_prompt));
                }));
            }

            json response_json;
            for (auto& fut : futures) {
                auto result = fut.get();
                response_json[result.first] = result.second;
            }

            res.set_content(response_json.dump(), "application/json");
            std::cout << "✅ [M3] Swarm Response Sent" << std::endl;

        } catch (const std::exception& e) {
            std::cerr << "❌ [M3] Error: " << e.what() << std::endl;
            res.status = 400;
            res.set_content("{\"error\":\"Invalid JSON or logic error\"}", "application/json");
        }
    });

    // 4. Clear KV Cache on all agents (handles shared ports with --parallel slots)
    svr.Post("/api/clear-cache", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [M3] Clearing KV cache on all agents..." << std::endl;

        // Build port -> slot_count map (agents sharing a port each get their own slot)
        std::map<int, int> port_slots;
        for (const auto& a : agents) port_slots[a.port]++;

        // Erase every slot on every unique port in parallel
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
                        auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase", "", "application/json");
                        if (!r || r->status != 200) all_ok = false;
                    }
                    result = all_ok ? "cleared" : "partial";
                } catch (const std::exception& e) {
                    result = std::string("error: ") + e.what();
                }
                return std::make_pair(port, result);
            }));
        }

        // Map results back to agent names for the response
        std::map<int, std::string> port_results;
        for (auto& fut : futures) {
            auto pr = fut.get();
            port_results[pr.first] = pr.second;
            std::cout << "  port " << pr.first << ": " << pr.second << std::endl;
        }
        json results;
        for (const auto& a : agents) {
            results[a.name] = port_results[a.port];
        }

        res.set_content(results.dump(), "application/json");
        std::cout << "✅ [M3] KV cache clear complete" << std::endl;
    });

    // 6. Global Preflight (CORS)
    svr.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    std::cout << "========================================" << std::endl;
    std::cout << "🌐 MATRIX COORDINATOR: ONLINE (Port 8000)" << std::endl;
    std::cout << "========================================" << std::endl;

    svr.listen("0.0.0.0", 8000);
    return 0;
}
