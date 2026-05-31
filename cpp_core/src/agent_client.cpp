#include "agent_client.h"
#include "agent_client_pool.h"
#include "agent_health.h"
#include "agent_metrics.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"
#include "mlx_inflight.h"
#include "response_cache.h"
#include "utf8_sanitize.h"

#include <chrono>
#include <iostream>
#include <memory>
#include <thread>

using json = nlohmann::json;

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
        auto cli_ptr = pool_checkout(agent.port, agent.read_timeout_secs);
        httplib::Client& cli = *cli_ptr;

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
        if (agent.engine == "llama") {
            body["cache_prompt"] = true;
            // Stop at any chat-template turn marker we might leak past EOS.
            // Covers ChatML (Codestral/Qwen/Phi-4), Llama-3, and generic.
            body["stop"] = {"<|im_end|>", "<|im_start|>",
                            "<|eot_id|>", "<|start_header_id|>",
                            "<|endoftext|>"};
        }

        auto t_start = std::chrono::steady_clock::now();
        auto res = cli.Post("/v1/chat/completions", body.dump(), "application/json");
        auto t_end = std::chrono::steady_clock::now();

        if (res && res->status == 200) {
            auto j = json::parse(sanitize_invalid_utf8(res->body));
            if (j.contains("choices") && !j["choices"].empty()) {
                out.text = strip_template_leakage(
                    sanitize_invalid_utf8(j["choices"][0]["message"]["content"].get<std::string>()));
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
                auto err = json::parse(sanitize_invalid_utf8(res->body));
                if (err.contains("error") && err["error"].contains("message")) {
                    out.text = "[" + agent.name + " error] "
                             + sanitize_invalid_utf8(err["error"]["message"].get<std::string>());
                }
            } catch (...) {
                std::cerr << "[coordinator] Non-JSON error body from " << agent.name
                          << " (status " << res->status << ")" << std::endl;
            }
        } else {
            // Connect/read timeout or refused connection.
            out.retryable = true;
        }
        // Return healthy connections to the pool; drop on error so stale
        // sockets don't accumulate (pool will create fresh ones on next call).
        if (!out.retryable)
            pool_checkin(agent.port, std::move(cli_ptr));
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
                                   const std::string& system_prompt_in,
                                   const std::string& prompt_in) {
    // Prepend the agent's short description (role tag) when present so it
    // applies uniformly across flat / pipeline / router / cascade modes.
    std::string system_prompt = system_prompt_in;
    if (!agent.description.empty()) {
        system_prompt = "# Role\n" + agent.description + "\n\n" + system_prompt_in;
    }
    system_prompt = sanitize_invalid_utf8(system_prompt);
    std::string prompt = sanitize_invalid_utf8(prompt_in);
    // Exact-prompt cache short-circuits both retries and inflight tracking.
    if (auto cached = response_cache::lookup(agent, system_prompt, prompt)) {
        return *cached;
    }
    std::unique_ptr<mlx_inflight::Scope> mlx_pressure;
    if (agent.engine == "mlx")
        mlx_pressure = std::make_unique<mlx_inflight::Scope>(agent.port);
    semaphore_acquire(agent.port);

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
    const bool had_waiters = semaphore_release_has_waiters(agent.port);
    // Yield only when another caller is queued, letting it start before we return.
    if (agent.engine == "mlx" && had_waiters)
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
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
