#include "agent_client.h"
#include "httplib.h"
#include "json.hpp"
#include "mlx_inflight.h"

#include <chrono>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <thread>

using json = nlohmann::json;

// mlx-lm does not support concurrent requests on the same port.
// Serialize all calls to mlx ports via a per-port mutex.
static std::map<int, std::unique_ptr<std::mutex>> mlx_port_locks;

void init_mlx_port_locks(const std::vector<Agent>& agents) {
    for (const auto& a : agents) {
        if (a.engine == "mlx" && mlx_port_locks.find(a.port) == mlx_port_locks.end()) {
            mlx_port_locks[a.port] = std::make_unique<std::mutex>();
        }
    }
}

static std::string call_agent_impl(const Agent& agent,
                                   const std::string& system_prompt,
                                   const std::string& prompt) {
    // Serialize requests to mlx-lm servers — they crash on concurrent batch prompts.
    // Count inflight (queued + active) BEFORE the mutex so the pressure gauge
    // reflects waiters too, not just the one slot currently decoding.
    std::unique_ptr<mlx_inflight::Scope> mlx_pressure;
    std::unique_lock<std::mutex> mlx_lock;
    if (agent.engine == "mlx") {
        mlx_pressure = std::make_unique<mlx_inflight::Scope>(agent.port);
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
        if (agent.engine == "mlx" && !system_prompt.empty()) {
            messages.push_back({{"role", "user"}, {"content", system_prompt + "\n\n" + prompt}});
        } else {
            if (!system_prompt.empty())
                messages.push_back({{"role", "system"}, {"content", system_prompt}});
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

        auto t_start = std::chrono::steady_clock::now();
        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");
        auto t_end = std::chrono::steady_clock::now();

        std::string result;
        if (res && res->status == 200) {
            auto j = json::parse(res->body);
            if (j.contains("choices") && !j["choices"].empty()) {
                result = j["choices"][0]["message"]["content"];
            }
            if (agent.engine == "mlx" && j.contains("usage") && j["usage"].is_object()) {
                long ctoks = j["usage"].value("completion_tokens", -1L);
                if (ctoks >= 0) {
                    double secs = std::chrono::duration<double>(t_end - t_start).count();
                    mlx_inflight::record_completion(agent.port, secs, ctoks);
                }
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

std::string call_agent(const Agent& agent, const std::string& prompt) {
    return call_agent_impl(agent, agent.system_prompt, prompt);
}

std::string call_agent_with_system(const Agent& agent,
                                   const std::string& system_prompt_override,
                                   const std::string& prompt) {
    return call_agent_impl(agent, system_prompt_override, prompt);
}
