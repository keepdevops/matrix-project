#pragma once
// MS-161 Phase B: in-process MLX model registry + serialized GPU lane.
//
// Holds MLX models resident in the embedded interpreter (one copy per model
// path, shared across agents) and runs generation in-process — removing the
// HTTP round-trip to mlx_lm.server (+74–107% single-stream, MS-153/Phase A).
//
// Concurrency: all generation passes through ONE serialized lane (MlxGpuLane).
// MS-160 showed a single GPU gives no concurrent throughput, and concurrent
// Metal submission triggers OOM — serializing is therefore free AND safe.
//
// Compiled only when MATRIX_MLX_EMBED=1 (the coordinator enables it via the
// MATRIX_MLX_INPROC build flag, which implies MATRIX_MLX_EMBED).

#ifdef MATRIX_MLX_EMBED

#include "agent.h"
#include "json.hpp"

#include <functional>
#include <string>

namespace mlx_inproc {

struct GenResult {
    bool        ok       = false;
    std::string text;
    int         n_tokens = 0;
    double      tok_s    = 0.0;
    std::string error;
};

// Process-singleton registry. Thread-safe: every generate() serializes on the
// internal lane mutex (one in-flight generation per process) and manages the
// CPython GIL around the call.
class MlxModelRegistry {
public:
    static constexpr int DEFAULT_IDLE_SECS = 600;  // evict models idle > 10 min

    // Load model for `agent` on first use (resident, keyed by model path),
    // then generate up to max_tokens for `prompt`. Serialized via the lane.
    GenResult generate(const Agent& agent, const std::string& prompt, int max_tokens);

    // MS-161 Phase C: streaming variant — drives mlx_lm.stream_generate and
    // invokes on_token per chunk (for the SSE stream path). Returns the full
    // assembled text. Serialized via the same lane.
    using OnToken = std::function<void(const std::string& delta)>;
    GenResult generate_stream(const Agent& agent, const std::string& prompt,
                              int max_tokens, const OnToken& on_token);

    int  evict_idle(int max_idle_secs = DEFAULT_IDLE_SECS);  // returns # evicted
    int  resident_count() const;
    nlohmann::json snapshot() const;   // [{model, agents_seen, calls, idle_secs}] for /pressure
};

MlxModelRegistry& mlx_models();   // process singleton, mirrors mlx_sessions()

}  // namespace mlx_inproc

#endif  // MATRIX_MLX_EMBED
