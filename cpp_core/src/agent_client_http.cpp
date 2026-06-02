#include "agent_client_http.h"
#include "agent_client_pool.h"
#include "agent_metrics.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"
#include "mlx_inflight.h"
#include "prefix_cache.h"
#include "session_context.h"
#include "token_ledger.h"
#include "utf8_sanitize.h"

#include <chrono>
#include <iostream>

using json = nlohmann::json;

AttemptResult call_agent_once(const Agent& agent,
                              const std::string& system_prompt,
                              const std::string& prompt) {
    AttemptResult out;
    try {
        auto cli_ptr = pool_checkout(agent.port, agent.read_timeout_secs);
        httplib::Client& cli = *cli_ptr;

        // Enforce max_input_tokens cap: ~4 chars per token (rough estimate)
        const std::string& eff_prompt = (agent.max_input_tokens > 0
            && (int)prompt.size() > agent.max_input_tokens * 4)
            ? prompt.substr(0, static_cast<size_t>(agent.max_input_tokens) * 4)
            : prompt;

        json messages = json::array();
        if (agent.engine == "mlx" && !system_prompt.empty()) {
            messages.push_back({{"role", "user"}, {"content", system_prompt + "\n\n" + eff_prompt}});
        } else {
            if (!system_prompt.empty())
                messages.push_back({{"role", "system"}, {"content", system_prompt}});
            messages.push_back({{"role", "user"}, {"content", eff_prompt}});
        }
        int out_cap = agent.max_output_tokens > 0 ? agent.max_output_tokens : agent.max_tokens;
        json body = {{"messages", messages}, {"max_tokens", out_cap}};
        if (!agent.model.empty() && (agent.backend == "docker" || agent.backend == "vllm"
                                     || agent.backend == "docker-vllm")) {
            body["model"] = agent.model;
        }
        if (agent.engine == "llama") {
            if (agent.max_output_tokens > 0) body["num_predict"] = agent.max_output_tokens;
            body["cache_prompt"] = true;
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
                prefix_cache::record(agent.port, system_prompt + "\n" + prompt);
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
                token_ledger::add(session_context::current(), ptoks, ctoks);
            } else {
                out.retryable = true;
            }
        } else if (res) {
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
            out.retryable = true;
        }

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
