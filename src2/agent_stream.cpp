#include "agent_stream.h"
#include "agent_client.h"
#include "httplib.h"
#include "json.hpp"
#include "kv_router.h"

#include <iostream>
#include <string>

using json = nlohmann::json;

namespace agent_stream {
namespace {

// Parse a single SSE frame body (text after "data: ") and append any token
// delta from OpenAI-style chat-completions chunks to `out`. Returns true if
// the stream-end marker [DONE] was seen.
bool parse_sse_frame(const std::string& payload,
                     OnChunk& on_chunk,
                     std::string& accumulated) {
    if (payload == "[DONE]") return true;
    try {
        auto j = json::parse(payload);
        if (!j.contains("choices") || !j["choices"].is_array()) return false;
        for (const auto& c : j["choices"]) {
            if (!c.contains("delta")) continue;
            const auto& d = c["delta"];
            if (!d.contains("content") || !d["content"].is_string()) continue;
            std::string delta = d["content"].get<std::string>();
            if (delta.empty()) continue;
            accumulated += delta;
            on_chunk(delta);
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
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel) {
    httplib::Client cli("127.0.0.1", agent.port);
    cli.set_connection_timeout(5);
    cli.set_read_timeout(agent.read_timeout_secs);

    json messages = json::array();
    if (!system_prompt.empty())
        messages.push_back({{"role", "system"}, {"content", system_prompt}});
    messages.push_back({{"role", "user"}, {"content", prompt}});

    json body = {
        {"messages", messages},
        {"max_tokens", agent.max_tokens},
        {"stream", true},
        {"cache_prompt", true}
    };

    std::string accumulated;
    std::string buf;
    bool done = false;

    auto receiver = [&](const char* data, size_t n) -> bool {
        if (cancel && cancel->load()) return false;
        buf.append(data, n);
        drain_frames(buf, on_chunk, accumulated, done);
        return !done;
    };

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
    // Final flush in case server closed without trailing blank line.
    if (!buf.empty()) {
        buf += "\n\n";
        drain_frames(buf, on_chunk, accumulated, done);
    }
    if (!accumulated.empty()) {
        kv_router::note_prefix(agent.name, system_prompt + "\n" + prompt);
    }
    return accumulated;
}

std::string stream_mlx_oneshot(const Agent& agent,
                               const std::string& system_prompt,
                               const std::string& prompt,
                               OnChunk on_chunk) {
    // MLX path: reuse the existing blocking caller, emit one chunk.
    std::string full = call_agent_with_system(agent, system_prompt, prompt);
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
