#pragma once
// MS-68 2c′-B: prompt-cache setup codegen — PURE string construction.
//
// Deliberately NOT behind MATRIX_MLX_EMBED and NOT dependent on <Python.h>:
// build_stream_setup only assembles the Python *source* that the embed runtime
// later executes. Keeping it Python-free lets it be unit-tested standalone
// (tests/cpp/test_prompt_cache_codegen.cpp) — the #291 regression (kv_bits being
// passed to make_prompt_cache, which has no such kwarg) is a codegen mistake, so
// the guard belongs here, not in a live-MLX integration test.

#include <string>

namespace model_mem {

// Build the Python setup snippet for generate_stream:
//   cache OFF → stateless path (byte-identical to pre-2c′).
//   cache ON  → tokenize, LCP, trim, delta-feed; timestamps updated; stale
//               sessions evicted opportunistically (idle > idle_secs).
//   quantized → request 4-bit KV on the generation call (NOT on the cache).
std::string build_stream_setup(const std::string& model_path,
                               const std::string& prompt, int max_tokens,
                               bool use_cache, const std::string& session_id,
                               int min_ctx, bool quantized, int idle_secs);

}  // namespace model_mem
