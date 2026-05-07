#include "agent_client.h"
#include "agent_health.h"
#include "agent_metrics.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"
#include "mlx_inflight.h"
#include "response_cache.h"

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

// Return shape of one HTTP attempt. `retryable` distinguishes transient
// failures (worth a second try) from deterministic ones (4xx — bad request,
// model not loaded — retrying just wastes time).
struct AttemptResult {
    std::string text;        // either the model's response, or an error marker string
    bool ok = false;         // true iff a non-empty response from a 200 came back
    bool retryable = false;  // 5xx, empty body, or exception
};

static AttemptResult call_agent_once(const Agent& agent,
                                     const std::string& system_prompt,
                                     const std::string& prompt) {
    AttemptResult out;
    try {
        httplib::Client cli("127.0.0.1", agent.port);
        cli.set_connection_timeout(5);
        cli.set_read_timeout(agent.read_timeout_secs);

        json messages = json::array();
        if (agent.engine == "mlx" && !system_prompt.empty()) {
            messages.push_back({{"role", "user"}, {"content", system_prompt + "\n\n" + prompt}});
        } else {
            if (!system_prompt.empty())
                messages.push_back({{"role", "system"}, {"content", system_prompt}});
            messages.push_back({{"role", "user"}, {"content", prompt}});
        }
        json body = {{"messages", messages}, {"max_tokens", agent.max_tokens}};
        if (!agent.model.empty() && (agent.backend == "docker" || agent.backend == "vllm"
                                     || agent.backend == "docker-vllm")) {
            body["model"] = agent.model;
        }
        if (agent.engine == "llama") body["cache_prompt"] = true;

        auto t_start = std::chrono::steady_clock::now();
        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");
        auto t_end = std::chrono::steady_clock::now();

        if (res && res->status == 200) {
            auto j = json::parse(res->body);
            if (j.contains("choices") && !j["choices"].empty()) {
                out.text = j["choices"][0]["message"]["content"];
            }
            if (agent.engine == "llama") {
                kv_router::note_prefix(agent.name, system_prompt + "\n" + prompt);
            }
            long ctoks = -1, ptoks = -1;
            if (j.contains("usage") && j["usage"].is_object()) {
                ctoks = j["usage"].value("completion_tokens", -1L);
                ptoks = j["usage"].value("prompt_tokens", -1L);
            }
            if (agent.engine == "mlx" && ctoks >= 0) {
                double secs = std::chrono::duration<double>(t_end - t_start).count();
                mlx_inflight::record_completion(agent.port, secs, ctoks);
            }
            if (!out.text.empty()) {
                out.ok = true;
                double ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
                agent_metrics::record(agent.name, ms, ctoks, ptoks);
            } else {
                // 200 with no content — treat as transient (server hiccup).
                out.retryable = true;
            }
        } else if (res) {
            // Server reachable. 5xx is transient, 4xx is deterministic.
            out.retryable = (res->status >= 500 && res->status < 600);
            try {
                auto err = json::parse(res->body);
                if (err.contains("error") && err["error"].contains("message")) {
                    out.text = "[" + agent.name + " error] "
                             + err["error"]["message"].get<std::string>();
                }
            } catch (...) {
                std::cerr << "[coordinator] Non-JSON error body from " << agent.name
                          << " (status " << res->status << ")" << std::endl;
            }
        } else {
            // Connect/read timeout or refused connection.
            out.retryable = true;
        }
        return out;
    } catch (const std::exception& e) {
        std::cerr << "[coordinator] call_agent exception for " << agent.name
                  << ": " << e.what() << std::endl;
        out.text = "Connection Error (" + agent.name + "): " + std::string(e.what());
        out.retryable = true;
        return out;
    }
}

// One retry on transient failure (5xx / empty body / network error). 4xx and
// successful responses return immediately. Backoff is short — the breaker
// owns the longer-term unhealthy-agent story.
static constexpr int RETRY_ATTEMPTS = 2;
static constexpr int RETRY_BACKOFF_MS = 250;

static std::string call_agent_impl(const Agent& agent,
                                   const std::string& system_prompt,
                                   const std::string& prompt) {
    // Exact-prompt cache short-circuits both retries and inflight tracking.
    if (auto cached = response_cache::lookup(agent, system_prompt, prompt)) {
        return *cached;
    }
    std::unique_ptr<mlx_inflight::Scope> mlx_pressure;
    std::unique_lock<std::mutex> mlx_lock;
    if (agent.engine == "mlx") {
        mlx_pressure = std::make_unique<mlx_inflight::Scope>(agent.port);
        auto it = mlx_port_locks.find(agent.port);
        if (it != mlx_port_locks.end()) {
            mlx_lock = std::unique_lock<std::mutex>(*it->second);
        }
    }

    AttemptResult attempt;
    for (int i = 0; i < RETRY_ATTEMPTS; ++i) {
        attempt = call_agent_once(agent, system_prompt, prompt);
        if (attempt.ok || !attempt.retryable) break;
        if (i + 1 < RETRY_ATTEMPTS) {
            std::cerr << "🔁 [retry] " << agent.name << " transient failure; "
                      << "retrying in " << RETRY_BACKOFF_MS << "ms" << std::endl;
            std::this_thread::sleep_for(std::chrono::milliseconds(RETRY_BACKOFF_MS));
        }
    }

    std::string result = attempt.text;
    if (result.empty()) {
        result = "Agent " + agent.name + " (Port "
               + std::to_string(agent.port) + ") is not responding.";
    } else if (attempt.ok) {
        response_cache::store(agent, system_prompt, prompt, result);
    }
    if (agent.engine == "mlx") {
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
    }
    agent_health::record(agent.name, attempt.ok);
    return result;
}

std::string call_agent(const Agent& agent, const std::string& prompt) {
    return call_agent_impl(agent, agent.system_prompt, prompt);
}

std::string call_agent_with_system(const Agent& agent,
                                   const std::string& system_prompt_override,
                                   const std::string& prompt) {
    return call_agent_impl(agent, system_prompt_override, prompt);
}
