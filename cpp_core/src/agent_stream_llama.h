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
#include "mlx_inflight.h"
#include "session_context.h"
#include "token_ledger.h"
#include "utf8_sanitize.h"

#include <atomic>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

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
        // Approximate token counts (4 chars ≈ 1 token) for ledger accounting
        long ptoks = static_cast<long>((system_prompt.size() + prompt.size()) / 4 + 1);
        long ctoks = static_cast<long>(accumulated.size() / 4 + 1);
        token_ledger::add(session_context::current(), ptoks, ctoks);
    }
    return accumulated;
}

// MS-148: true SSE streaming for mlx_lm.server (stream=true + sse::drain_frames).
// Replaces stream_mlx_oneshot (blocking one-shot) to reduce TTFB.
// Uses the stream connection pool for keep-alive reuse across calls.
inline std::string stream_mlx(const Agent& agent,
                               const std::string& system_prompt_in,
                               const std::string& prompt_in,
                               OnChunk on_chunk,
                               std::atomic<bool>* cancel = nullptr) {
    mlx_inflight::Scope inflight(agent.port);
    semaphore_acquire(agent.port);

    auto cli_ptr = stream_pool_checkout(agent.port, agent.read_timeout_secs);
    httplib::Client& cli = *cli_ptr;

    const std::string system_prompt = sanitize_invalid_utf8(system_prompt_in);
    const std::string prompt        = sanitize_invalid_utf8(prompt_in);

    json messages = json::array();
    if (!system_prompt.empty())
        messages.push_back({{"role", "system"}, {"content", system_prompt}});
    messages.push_back({{"role", "user"}, {"content", prompt}});

    json body = {
        {"messages",   messages},
        {"max_tokens", agent.max_tokens},
        {"stream",     true},
        {"stop",       {"<|im_end|>", "<|im_start|>", "<|eot_id|>", "<|endoftext|>"}},
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
    auto res     = cli.Post("/v1/chat/completions",
                            httplib::Headers{{"Accept", "text/event-stream"}},
                            body.dump(), "application/json",
                            receiver);

    const bool had_waiters = semaphore_release_has_waiters(agent.port);
    if (had_waiters)
        std::this_thread::sleep_for(std::chrono::milliseconds(200));

    if (!res) {
        std::cerr << "[mlx_stream] " << agent.name << " connect failed" << std::endl;
        std::string err = "Agent " + agent.name + " (Port "
                          + std::to_string(agent.port) + ") is not responding.";
        on_chunk(err);
        return err;
    }

    stream_pool_checkin(agent.port, std::move(cli_ptr));
    if (!buf.empty()) { buf += "\n\n"; sse::drain_frames(buf, on_chunk, accumulated, done); }

    auto t_end = std::chrono::steady_clock::now();
    accumulated = strip_template_leakage(std::move(accumulated));
    if (!accumulated.empty()) {
        double secs  = std::chrono::duration<double>(t_end - t_start).count();
        long   ctoks = static_cast<long>(accumulated.size() / 4 + 1);
        mlx_inflight::record_completion(agent.port, secs, ctoks);
        double ms    = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        agent_metrics::record(agent.name, ms, ctoks, -1);
        long ptoks   = static_cast<long>((system_prompt.size() + prompt.size()) / 4 + 1);
        token_ledger::add(session_context::current(), ptoks, ctoks);
    }
    return accumulated;
}

} // namespace agent_stream
