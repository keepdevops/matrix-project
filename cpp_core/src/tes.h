#pragma once
// Token Efficiency Score (TES) = (tokens_consumed / elapsed_ms) * quality_score.
// Higher is more efficient. Quality score defaults to 1.0 when no QP pass is used.
// Included inline — no .cpp needed.

#include "json.hpp"
#include <algorithm>

namespace tes {

/// Compute TES from an envelope's meta block.
/// Returns 0.0 if data is insufficient.
inline double compute(const nlohmann::json& meta) {
    if (!meta.is_object()) return 0.0;

    double wall_ms = meta.value("wall_ms", 0.0);
    if (wall_ms <= 0.0) return 0.0;

    int consumed = 0;
    if (meta.contains("token_budget") && meta["token_budget"].is_object())
        consumed = meta["token_budget"].value("consumed", 0);
    if (consumed <= 0) return 0.0;

    double quality = 1.0;
    if (meta.contains("quality_pass") && meta["quality_pass"].is_object()
        && meta["quality_pass"].value("used", false)) {
        // quality_pass used → reward: treat as 1.0 (already quality-selected)
        quality = 1.0;
    }

    return (static_cast<double>(consumed) / wall_ms) * quality;
}

} // namespace tes
