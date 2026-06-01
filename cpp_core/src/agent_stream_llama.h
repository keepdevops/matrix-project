#pragma once
// Inline streaming implementations — included only by agent_stream.cpp.

#include "agent_client_pool.h"
#include "agent_metrics.h"
#include "agent_client.h"
#include "agent_stream_pool.h"
#include "agent_stream_sse.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"
#include "utf8_sanitize.h"

#include <atomic>
#include <chrono>
#include <iostream>
#include <string>

namespace agent_stream {

using json = nlohmann::json;

inline std::string stream_llama(const Agent& agent,
                                const std::string& system_prompt_in,
                                const std::string& prompt_in,
                                OnChunk on_chunk,
                                std::atomic<bool>* cancel) {
    auto cli_ptr = stream_pool_checkout(agent.port, agent.read_timeout_secs);
    httplib::Client& cli = *cli_ptr;

    const std::string system_prompt = sanitize_invalid_utf8(system_prompt_in);
    const std::string prompt = sanitize_invalid_utf8(prompt_in);
    json messages = json::array();
    if (!system_prompt.empty())
        messages.push_back({{"role", "system"}, {"content", system_prompt}});
    messages.push_back({{"role", "user"}, {"content", prompt}});

    json body = {
        {"messages", messages},
        {"max_tokens", agent.max_tokens},
        {"stream", true},
        {"cache_prompt", true},
        {"stop", {"<|im_end|>", "<|im_start|>",
                  "<|eot_id|>", "<|start_header_id|>",
                  "<|endoftext|>"}}
    };

    std::string accumulated;
    std::string buf;
    bool done = false;

    auto receiver = [&](const char* data, size_t n) -> bool {
        if (cancel && cancel->load()) return false;
        buf.append(data, n);
        sse::drain_frames(buf, on_chunk, accumulated, done);
        return true;
    };

    auto t_start = std::chrono::steady_clock::now();
    auto res = cli.Post("/v1/chat/completions",
                        httplib::Headers{{"Accept", "text/event-stream"}},
                        body.dump(), "application/json",
                        receiver);

    if (!res) {
        std::cerr << "[agent_stream] " << agent.name
                  << " stream connect failed" << std::endl;
        std::string fallback = "Agent " + agent.name + " (Port "
                               + std::to_string(agent.port) + ") is not responding.";
        on_chunk(fallback);
        return fallback;
    }
    stream_pool_checkin(agent.port, std::move(cli_ptr));
    if (!buf.empty()) {
        buf += "\n\n";
        sse::drain_frames(buf, on_chunk, accumulated, done);
    }
    auto t_end = std::chrono::steady_clock::now();
    accumulated = strip_template_leakage(std::move(accumulated));
    if (!accumulated.empty()) {
        kv_router::note_prefix(agent.name, system_prompt + "\n" + prompt);
        double ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        long words = 1;
        for (char c : accumulated) if (c == ' ') ++words;
        agent_metrics::record(agent.name, ms, words, -1);
    }
    return accumulated;
}

inline std::string stream_mlx_oneshot(const Agent& agent,
                                      const std::string& system_prompt,
                                      const std::string& prompt,
                                      OnChunk on_chunk) {
    std::string full = sanitize_invalid_utf8(call_agent_with_system(agent, system_prompt, prompt));
    if (!full.empty()) on_chunk(full);
    return full;
}

} // namespace agent_stream
