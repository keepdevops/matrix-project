#pragma once
// Streaming variant of agent_client. Opens a chat-completions request to a
// single agent with stream=true (llama-server) and invokes on_chunk for each
// incremental token delta. MLX agents do not stream natively — for them the
// full response is delivered as one chunk on completion.
//
// Caller is responsible for thread-safety of on_chunk (this module does not
// serialize callbacks across agents — coordinator multiplexes via its own
// write mutex).

#include "agent.h"

#include <atomic>
#include <functional>
#include <string>

namespace agent_stream {

// Called per token (or per chunk for MLX). `delta` is the new text only;
// concatenate to assemble the full response. `on_chunk` may be invoked from
// any thread. Empty deltas are not emitted.
using OnChunk = std::function<void(const std::string& delta)>;

// Stream a single agent. Returns the full assembled response. If `cancel` is
// flipped to true mid-stream, the call returns early with whatever has been
// received so far. `cancel` may be null.
// `session_id` injects mlx_session_store history for MLX engines; ignored otherwise.
std::string stream_agent(const Agent& agent,
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel = nullptr,
                         const std::string& session_id = "");

} // namespace agent_stream
