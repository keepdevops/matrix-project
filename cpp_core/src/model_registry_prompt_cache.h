#pragma once
#ifdef MATRIX_MLX_EMBED
// MS-68 2c′-B: prompt-cache session management — eviction, count, setup codegen.
// All functions must be called under the generation lane (g_lane_mu) with the
// GIL held, except prompt_cache_session_count() which reads an atomic.

#include <string>

#include "model_registry_prompt_cache_codegen.h"  // build_stream_setup (pure codegen)

namespace model_mem {

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
