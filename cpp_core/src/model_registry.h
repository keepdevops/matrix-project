#pragma once
// MS-68 Phase 2a: unified model registry.
//
// One registry, two layers:
//  • Always: (model_id, quant) ref-count accounting + pressure snapshot.
//  • Under MATRIX_MLX_EMBED: the resident in-process MLX models, serialized GPU
//    lane, and generate()/generate_stream() — folded in from MS-161's
//    mlx_inproc::MlxModelRegistry (which this replaces). Generation records
//    itself against the same (model_id, quant) entries, so pressure reports
//    in-process usage through the single accounting surface.

#include "json.hpp"
#include <map>
#include <mutex>
#include <string>

#ifdef MATRIX_MLX_EMBED
#include "agent.h"
#include <chrono>
#include <functional>
#include <set>
#endif

namespace model_mem {

struct ModelKey {
    std::string model_id;
    std::string quant;
    bool operator<(const ModelKey& o) const {
        return model_id < o.model_id
            || (model_id == o.model_id && quant < o.quant);
    }
};

struct ModelEntry {
    int  ref_count     = 0;   // outstanding acquire() holders
    int  acquire_calls = 0;   // cumulative acquire() count
    long gen_calls     = 0;   // in-process generations (embed builds)
#ifdef MATRIX_MLX_EMBED
    std::set<std::string>                 agents_seen;
    std::chrono::steady_clock::time_point last_used =
        std::chrono::steady_clock::now();
#endif
};

#ifdef MATRIX_MLX_EMBED
struct GenResult {
    bool        ok       = false;
    std::string text;
    int         n_tokens = 0;
    double      tok_s    = 0.0;
    std::string error;
};
#endif

class ModelRegistry {
public:
    static ModelRegistry& instance();

    // ── (model_id, quant) accounting — always available ──────────────────────
    bool acquire(const std::string& model_id, const std::string& quant);
    void release(const std::string& model_id, const std::string& quant);
    int  resident_count() const;
    nlohmann::json snapshot() const;   // {resident_count, models:[{...}]}

#ifdef MATRIX_MLX_EMBED
    // ── In-process MLX generation (from MS-161). One serialized GPU lane. ─────
    static constexpr int DEFAULT_IDLE_SECS = 600;  // evict models idle > 10 min
    using OnToken = std::function<void(const std::string& delta)>;

    // Load model for `agent` on first use (resident, keyed by model_id+quant),
    // generate up to max_tokens. Serialized via the lane; records the call.
    GenResult generate(const Agent& agent, const std::string& prompt, int max_tokens);

    // Streaming variant — drives mlx_lm.stream_generate, invoking on_token per
    // chunk. Same lane, same accounting. MS-68 2c′: when prompt-cache reuse is
    // enabled and session_id is set, reuses a per-session KV cache (delta-feed).
    GenResult generate_stream(const Agent& agent, const std::string& prompt,
                              int max_tokens, const OnToken& on_token,
                              const std::string& session_id = "");

    int evict_idle(int max_idle_secs = DEFAULT_IDLE_SECS);  // returns # evicted
#endif

private:
    ModelRegistry() = default;
    mutable std::mutex mu_;
    std::map<ModelKey, ModelEntry> entries_;

#ifdef MATRIX_MLX_EMBED
    // Record one in-process generation against (model_id, quant).
    void note_generation(const std::string& model_id, const std::string& quant,
                         const std::string& agent_name);
#endif
};

#ifdef MATRIX_MLX_EMBED
// MS-68 2c′-B: configure per-session prompt-cache reuse.
//   quantized=true → QuantizedKVCache(kv_bits=4) for new sessions.
//   idle_secs      → evict sessions idle longer than this (default 600).
void configure_prompt_cache(bool enabled, int min_ctx_tokens,
                            bool quantized = false, int idle_secs = 600);

// Returns the current number of active prompt-cache sessions (atomic, no GIL).
int prompt_cache_session_count();

// #297: resident-model idle eviction window. evict_idle() reclaims models
// unused longer than model_idle_secs(); the MLX routes call it opportunistically.
void configure_model_idle(int idle_secs);
int  model_idle_secs();
#endif

}  // namespace model_mem
