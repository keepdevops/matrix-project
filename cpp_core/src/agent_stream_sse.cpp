#include "agent_stream_sse.h"
#include "utf8_sanitize.h"

#include "json.hpp"

#include <iostream>
#include <string>

using json = nlohmann::json;

namespace agent_stream {
namespace sse {
namespace {

bool extract_content_fast(const std::string& payload, std::string& out) {
    static const char needle[] = "\"content\":\"";
    auto pos = payload.find(needle);
    if (pos == std::string::npos) return false;
    pos += sizeof(needle) - 1;
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
                case 'u':  return false;
                default:   result += esc; ++i; break;
            }
        } else if (c == '"') {
            out = std::move(result);
            return true;
        } else {
            result += c;
        }
    }
    return false;
}

bool parse_sse_frame(const std::string& payload,
                     OnChunk& on_chunk,
                     std::string& accumulated) {
    if (payload == "[DONE]") return true;

    std::string delta;
    if (extract_content_fast(payload, delta)) {
        if (!delta.empty()) {
            delta = sanitize_invalid_utf8(delta);
            accumulated += delta;
            on_chunk(delta);
        }
        return false;
    }

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

} // namespace

void drain_frames(std::string& buf, OnChunk& on_chunk,
                  std::string& accumulated, bool& done) {
    size_t pos;
    while ((pos = buf.find("\n\n")) != std::string::npos) {
        std::string frame = buf.substr(0, pos);
        buf.erase(0, pos + 2);
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

} // namespace sse
} // namespace agent_stream
