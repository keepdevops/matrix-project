#include "agent_stream.h"
#include "agent_metrics.h"
#include "agent_client.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"
#include "utf8_sanitize.h"

#include <chrono>
#include <deque>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>

using json = nlohmann::json;

namespace agent_stream {
namespace {

// Streaming-specific client pool — separate from the non-streaming pool in
// agent_client.cpp because streaming connections are long-lived (held open
// for the entire token stream) and non-streaming ones are short-lived.
static constexpr int STREAM_POOL_MAX = 4;
struct StreamClientPool {
    struct PortClients {
        std::deque<std::unique_ptr<httplib::Client>> idle;
        std::mutex mu;
    };
    std::map<int, std::unique_ptr<PortClients>> ports;
    std::mutex map_mu;

    std::unique_ptr<httplib::Client> checkout(int port, int read_timeout_secs) {
        {
            std::lock_guard<std::mutex> lk(map_mu);
            if (!ports.count(port)) ports[port] = std::make_unique<PortClients>();
        }
        PortClients* pc = ports[port].get();
        {
            std::lock_guard<std::mutex> lk(pc->mu);
            if (!pc->idle.empty()) {
                auto cli = std::move(pc->idle.front());
                pc->idle.pop_front();
                cli->set_read_timeout(read_timeout_secs);
                return cli;
            }
        }
        auto cli = std::make_unique<httplib::Client>("127.0.0.1", port);
        cli->set_keep_alive(true);
        cli->set_connection_timeout(5);
        cli->set_read_timeout(read_timeout_secs);
        return cli;
    }

    void checkin(int port, std::unique_ptr<httplib::Client> cli) {
        std::lock_guard<std::mutex> lk(map_mu);
        auto it = ports.find(port);
        if (it == ports.end()) return;
        PortClients* pc = it->second.get();
        std::lock_guard<std::mutex> lk2(pc->mu);
        if ((int)pc->idle.size() < STREAM_POOL_MAX)
            pc->idle.push_back(std::move(cli));
    }
};
static StreamClientPool g_stream_pool;

// Fast-path extractor for delta.content from an OpenAI-style SSE chunk.
// Avoids full JSON parse for the common case (ASCII/Latin text, no \u escapes).
// Returns false for [DONE], unicode escapes, or malformed frames → caller
// falls back to full json::parse.
bool extract_content_fast(const std::string& payload, std::string& out) {
    static const char needle[] = "\"content\":\"";
    auto pos = payload.find(needle);
    if (pos == std::string::npos) return false;
    pos += sizeof(needle) - 1; // skip past opening quote
    std::string result;
    result.reserve(64);
    for (size_t i = pos; i < payload.size(); ++i) {
        char c = payload[i];
        if (c == '\\') {
            if (i + 1 >= payload.size()) return false;
            char esc = payload[i + 1];
            switch (esc) {
                case '"':  result += '"';  ++i; break;
                case '\\': result += '\\'; ++i; break;
                case '/':  result += '/';  ++i; break;
                case 'n':  result += '\n'; ++i; break;
                case 'r':  result += '\r'; ++i; break;
                case 't':  result += '\t'; ++i; break;
                case 'u':  return false; // unicode escape — fall back
                default:   result += esc; ++i; break;
            }
        } else if (c == '"') {
            out = std::move(result);
            return true;
        } else {
            result += c;
        }
    }
    return false; // unterminated string
}

// Parse a single SSE frame body (text after "data: ") and append any token
// delta from OpenAI-style chat-completions chunks to `out`. Returns true if
// the stream-end marker [DONE] was seen.
bool parse_sse_frame(const std::string& payload,
                     OnChunk& on_chunk,
                     std::string& accumulated) {
    if (payload == "[DONE]") return true;

    // Fast path: extract content field without allocating a full JSON tree.
    std::string delta;
    if (extract_content_fast(payload, delta)) {
        if (!delta.empty()) {
            delta = sanitize_invalid_utf8(delta);
            accumulated += delta;
            on_chunk(delta);
        }
        return false;
    }

    // Slow path: full parse for unicode escapes, finish_reason frames, etc.
    try {
        auto j = json::parse(sanitize_invalid_utf8(payload));
        if (!j.contains("choices") || !j["choices"].is_array()) return false;
        for (const auto& c : j["choices"]) {
            if (!c.contains("delta")) continue;
            const auto& d = c["delta"];
            if (!d.contains("content") || !d["content"].is_string()) continue;
            std::string tok = sanitize_invalid_utf8(d["content"].get<std::string>());
            if (tok.empty()) continue;
            accumulated += tok;
            on_chunk(tok);
        }
    } catch (const std::exception& e) {
        std::cerr << "[agent_stream] frame parse error: " << e.what() << std::endl;
    }
    return false;
}

// Drain a buffer of "data: ...\n\n" frames into on_chunk. Leaves any partial
// trailing frame in `buf`.
void drain_frames(std::string& buf, OnChunk& on_chunk,
                  std::string& accumulated, bool& done) {
    size_t pos;
    while ((pos = buf.find("\n\n")) != std::string::npos) {
        std::string frame = buf.substr(0, pos);
        buf.erase(0, pos + 2);
        // Each frame may be multi-line ("data: x\ndata: y"); collect data fields.
        std::string payload;
        size_t line_start = 0;
        while (line_start <= frame.size()) {
            size_t line_end = frame.find('\n', line_start);
            std::string line = (line_end == std::string::npos)
                ? frame.substr(line_start)
                : frame.substr(line_start, line_end - line_start);
            if (line.rfind("data:", 0) == 0) {
                size_t off = (line.size() > 5 && line[5] == ' ') ? 6 : 5;
                if (!payload.empty()) payload += "\n";
                payload += line.substr(off);
            }
            if (line_end == std::string::npos) break;
            line_start = line_end + 1;
        }
        if (payload.empty()) continue;
        if (parse_sse_frame(payload, on_chunk, accumulated)) { done = true; return; }
    }
}

std::string stream_llama(const Agent& agent,
                         const std::string& system_prompt_in,
                         const std::string& prompt_in,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel) {
    auto cli_ptr = g_stream_pool.checkout(agent.port, agent.read_timeout_secs);
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
        // Halt on chat-template turn markers so we don't leak into a fresh
        // user/assistant turn after EOS. See agent_client.cpp for context.
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
        drain_frames(buf, on_chunk, accumulated, done);
        // Returning false here cancels the httplib request and produces a
        // null response, which we'd then treat as "stream connect failed"
        // and skip metric recording. Real servers close the socket after
        // [DONE] so reading until EOF is the right thing.
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
        // Don't return broken client to pool.
        std::string fallback = "Agent " + agent.name + " (Port "
                               + std::to_string(agent.port) + ") is not responding.";
        on_chunk(fallback);
        return fallback;
    }
    g_stream_pool.checkin(agent.port, std::move(cli_ptr));
    // Final flush in case server closed without trailing blank line.
    if (!buf.empty()) {
        buf += "\n\n";
        drain_frames(buf, on_chunk, accumulated, done);
    }
    auto t_end = std::chrono::steady_clock::now();
    // Trim any chat-template marker that slipped past the server-side stop.
    {
        static const char* markers[] = {
            "<|im_end|>", "<|im_start|>",
            "<|eot_id|>", "<|start_header_id|>",
            "<|endoftext|>",
        };
        size_t cut = std::string::npos;
        for (const char* m : markers) {
            size_t pos = accumulated.find(m);
            if (pos != std::string::npos && pos < cut) cut = pos;
        }
        if (cut != std::string::npos) accumulated.erase(cut);
        while (!accumulated.empty() &&
               (accumulated.back() == '\n' || accumulated.back() == ' ' ||
                accumulated.back() == '\t'))
            accumulated.pop_back();
    }
    if (!accumulated.empty()) {
        kv_router::note_prefix(agent.name, system_prompt + "\n" + prompt);
        // Approximate token count from word count — llama-server's SSE chunks
        // don't carry usage metadata. Good enough for a UX-grade dashboard.
        double ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        long words = 1;
        for (char c : accumulated) if (c == ' ') ++words;
        agent_metrics::record(agent.name, ms, words, -1);
    }
    return accumulated;
}

std::string stream_mlx_oneshot(const Agent& agent,
                               const std::string& system_prompt,
                               const std::string& prompt,
                               OnChunk on_chunk) {
    // MLX path: reuse the existing blocking caller, emit one chunk.
    std::string full = sanitize_invalid_utf8(call_agent_with_system(agent, system_prompt, prompt));
    if (!full.empty()) on_chunk(full);
    return full;
}

} // namespace

std::string stream_agent(const Agent& agent,
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel) {
    if (agent.engine == "llama") {
        return stream_llama(agent, system_prompt, prompt, std::move(on_chunk), cancel);
    }
    return stream_mlx_oneshot(agent, system_prompt, prompt, std::move(on_chunk));
}

} // namespace agent_stream
