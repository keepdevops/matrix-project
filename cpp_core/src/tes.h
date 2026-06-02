#pragma once
// Token Efficiency Score (TES) — multi-factor quality signal.
// Rich path: density + fidelity + importance + RAG contribution.
// Legacy path: (consumed / wall_ms) * quality for backward-compat.

#include "json.hpp"
#include <algorithm>
#include <cmath>

namespace tes {

struct TesFactors {
    double consumed_tokens = 0.0;
    double wall_ms         = 0.0;
    double fidelity_ratio  = 1.0;  // from context_gate; 1.0 = no compression
    double avg_importance  = 0.5;  // from symbolic_importance; 0.5 = neutral
    double rag_hit_rate    = 0.0;  // hits/top_k; 0 = no RAG used
};

/// Rich TES: weighted combination of density, fidelity, importance, RAG contribution.
/// Returns 0.0 when data is insufficient.
inline double compute_rich(const TesFactors& f) {
    if (f.wall_ms <= 0.0 || f.consumed_tokens <= 0.0) return 0.0;

    // Density: tokens per ms, normalised; target ~0.5 tok/ms
    double density = std::min(1.0, f.consumed_tokens / (f.wall_ms * 0.5));

    double tes = density        * 0.4
               + f.fidelity_ratio * 0.3
               + f.avg_importance * 0.2
               + f.rag_hit_rate   * 0.1;

    return std::max(0.0, std::min(1.0, tes));
}

/// Legacy envelope-based compute — enriched when rich fields are present.
inline double compute(const nlohmann::json& meta) {
    if (!meta.is_object()) return 0.0;

    double wall_ms = meta.value("wall_ms", 0.0);
    if (wall_ms <= 0.0) return 0.0;

    int consumed = 0;
    if (meta.contains("token_budget") && meta["token_budget"].is_object())
        consumed = meta["token_budget"].value("consumed", 0);
    if (consumed <= 0) return 0.0;

    // Use rich path when data available
    TesFactors f;
    f.consumed_tokens = static_cast<double>(consumed);
    f.wall_ms         = wall_ms;
    if (meta.contains("context_gate") && meta["context_gate"].is_object())
        f.fidelity_ratio = meta["context_gate"].value("fidelity_ratio", 1.0);
    if (meta.contains("avg_importance"))
        f.avg_importance = meta.value("avg_importance", 0.5);
    if (meta.contains("rag") && meta["rag"].is_object()) {
        int hits   = 0, top_k = meta["rag"].value("top_k", 0);
        if (meta["rag"].contains("hits") && meta["rag"]["hits"].is_array())
            hits = static_cast<int>(meta["rag"]["hits"].size());
        f.rag_hit_rate = (top_k > 0) ? static_cast<double>(hits) / top_k : 0.0;
    }

    return compute_rich(f);
}

} // namespace tes
