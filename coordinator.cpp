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
};

// Agents running via llama-server
std::vector<Agent> agents = {
    {"architect", 8080},
    {"logic", 8081},
    {"utility", 8082}
};

// Robust function to call agents via IPv4
std::string call_agent(const std::string& prompt, int port, const std::string& name) {
    try {
        httplib::Client cli("127.0.0.1", port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(60);

        json body = {
            {"messages", json::array({{{"role", "user"}, {"content", prompt}}})},
            {"max_tokens", 1024}
        };
        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");

        if (res && res->status == 200) {
            auto j = json::parse(res->body);
            if (j.contains("choices") && !j["choices"].empty()) {
                return j["choices"][0]["message"]["content"];
            }
        }
        return "Agent " + name + " (Port " + std::to_string(port) + ") is not responding.";
    } catch (const std::exception& e) {
        return "Connection Error (" + name + "): " + std::string(e.what());
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
                    return std::make_pair(agent.name, call_agent(user_prompt, agent.port, agent.name));
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

    // 4. Global Preflight (CORS)
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
