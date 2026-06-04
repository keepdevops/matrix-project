#pragma once
#ifdef MATRIX_MLX_EMBED
// MS-68 2c′-B: prompt-cache session management — eviction, count, setup codegen.
// All functions must be called under the generation lane (g_lane_mu) with the
// GIL held, except prompt_cache_session_count() which reads an atomic.

#include <string>

namespace model_mem {

// Build the Python setup snippet for generate_stream:
//   cache OFF → stateless path (byte-identical to pre-2c′).
//   cache ON  → tokenize, LCP, trim, delta-feed; timestamps updated; stale
//               sessions evicted opportunistically (idle > idle_secs).
//   quantized → use QuantizedKVCache(kv_bits=4) for new sessions.
std::string build_stream_setup(const std::string& model_path,
                               const std::string& prompt, int max_tokens,
                               bool use_cache, const std::string& session_id,
                               int min_ctx, bool quantized, int idle_secs);

// Evict sessions from __mlx_sess__ that have been idle > idle_secs.
// Returns number of sessions evicted. Must hold lane + GIL.
int evict_prompt_cache_sessions(int idle_secs);

// Returns cached count of active prompt-cache sessions (atomic — no GIL needed).
int prompt_cache_session_count();

// Called after each setup run to synchronise the C++ counter to the true live
// session count (__reg_sess_size__ = len(__mlx_sess__)). Absolute, not a delta,
// so opportunistic idle eviction can't make the gauge drift (#291).
void set_session_count(int n);

}  // namespace model_mem
#endif  // MATRIX_MLX_EMBED
