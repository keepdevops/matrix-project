#pragma once
#include "agent_stream.h"
#include <string>

namespace agent_stream {
namespace sse {

/** Parse buffered SSE frames; sets `done` when [DONE] is seen. */
void drain_frames(std::string& buf, OnChunk& on_chunk,
                  std::string& accumulated, bool& done);

/** MS-72/#302: from a raw receiver `chunk`, record into `last_data` the last
 *  `data:` line whose value is a JSON object ('{' …). Skips `[DONE]` and any
 *  non-JSON line, so a trailing `data: [DONE]` frame can't clobber the
 *  timings/usage frame that precedes it (the original `rfind` did). Header-only
 *  so it is unit-testable. (Frames split across receiver chunks fall back to the
 *  char estimate — acceptable; servers emit frames atomically in practice.) */
inline void capture_last_json_data(const std::string& chunk, std::string& last_data) {
    size_t pos = 0;
    while (pos < chunk.size()) {
        const size_t e   = chunk.find('\n', pos);
        const size_t len = (e == std::string::npos ? chunk.size() : e) - pos;
        std::string line = chunk.substr(pos, len);
        while (!line.empty() && (line.back() == '\r' || line.back() == ' ')) line.pop_back();
        if (line.rfind("data:", 0) == 0) {                  // SSE data line
            size_t s = 5;
            while (s < line.size() && line[s] == ' ') ++s;   // skip "data: " spaces
            const std::string val = line.substr(s);
            if (!val.empty() && val.front() == '{') last_data = val;  // JSON only; skips [DONE]
        }
        pos = (e == std::string::npos) ? chunk.size() : e + 1;
    }
}

} // namespace sse
} // namespace agent_stream
