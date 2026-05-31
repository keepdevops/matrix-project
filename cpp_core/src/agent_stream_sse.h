#pragma once
#include "agent_stream.h"
#include <string>

namespace agent_stream {
namespace sse {

/** Parse buffered SSE frames; sets `done` when [DONE] is seen. */
void drain_frames(std::string& buf, OnChunk& on_chunk,
                  std::string& accumulated, bool& done);

} // namespace sse
} // namespace agent_stream
