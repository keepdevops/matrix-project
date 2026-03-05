#include "httplib.h"
#include "json.hpp"
#include <iostream>
#include <string>
#include <future>
#include <vector>
#include <algorithm>

using json = nlohmann::json;

struct Agent {
    std::string name;
    int port;
    int read_timeout_secs;
    int max_tokens;
    std::string system_prompt;
};

// Five-role swarm
std::vector<Agent> agents = {
    {
        "architect",
        8080,
        60,
        1024,
        "You are the Lead Architect. Produce ASCII UML diagrams, system design documents, "
        "component relationships, and high-level architecture decisions. Be precise and visual."
    },
    {
        "specialist",
        8081,
        60,
        1024,
        "You are a Systems Specialist expert in C++ and Go. Focus on performance-critical "
        "implementation, memory management, concurrency patterns, and low-level system design."
    },
    {
        "scout",
        8082,
        60,
        1024,
        "You are the Context Scout. Analyze large codebases to identify relevant patterns, "
        "dependencies, module boundaries, and reusable solutions that apply to the task."
    },
    {
        "programmer",
        8083,
        300,
        4096,
        "You are the Programmer. Produce complete, production-ready code with all imports, "
        "error handling, and full implementation. Never use placeholders or omit code."
    },
    {
        "synthesis",
        8084,
        60,
        1024,
        "You are the Master Planner. Synthesize all inputs into a coherent execution roadmap. "
        "Prioritize steps, identify risks, and produce a clear actionable plan."
    }
};

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
        return "Agent " + agent.name + " (Port " + std::to_string(agent.port) + ") is not responding.";
    } catch (const std::exception& e) {
        return "Connection Error (" + agent.name + "): " + std::string(e.what());
    }
}

int main() {
    httplib::Server svr;

    // 1. Health Route (Fixes the "Proxy Unreachable" error)
    svr.Get("/api/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content("{\"status\":\"ok\",\"engine\":\"matrix-m3\"}", "application/json");
        std::cout << "🩺 [M3] Health Check: 200 OK" << std::endl;
    });

    // 2. History Route (Fixes the 404 in the sidebar)
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

    // 4. Clear KV Cache on all agents
    svr.Post("/api/clear-cache", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::cout << "\n🗑️  [M3] Clearing KV cache on all agents..." << std::endl;

        json results;
        for (const auto& agent : agents) {
            try {
                httplib::Client cli("127.0.0.1", agent.port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(10);
                auto r = cli.Post("/slots/0?action=erase", "", "application/json");
                results[agent.name] = (r && r->status == 200) ? "cleared" : "failed";
                std::cout << "  " << agent.name << ": "
                          << results[agent.name] << std::endl;
            } catch (const std::exception& e) {
                results[agent.name] = "error";
                std::cerr << "  " << agent.name << ": " << e.what() << std::endl;
            }
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
