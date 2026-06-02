#pragma once
// Trajectory quality scorer for distillation export.
// Combines TES, fidelity, importance, RAG, and annotation into a 0–1 signal.

#include "json.hpp"
#include <algorithm>

namespace trajectory_quality {

struct QualityFactors {
    double tes             = 0.0;
    double fidelity_ratio  = 1.0;
    double avg_importance  = 0.5;
    double rag_hit_rate    = 0.0;
    int    annotation_rating = 0; // 1=up, -1=down, 0=none
    bool   any_overrun     = false;
};

/// Weighted quality score 0–1. Returns -1 if no meaningful data.
inline double compute(const QualityFactors& f) {
    if (f.tes <= 0.0 && f.avg_importance <= 0.0) return -1.0;

    double annotation_bonus = 0.0;
    if (f.annotation_rating ==  1) annotation_bonus =  0.15;
    if (f.annotation_rating == -1) annotation_bonus = -0.20;

    double overrun_penalty = f.any_overrun ? 0.10 : 0.0;

    double score = f.tes           * 0.35
                 + f.fidelity_ratio * 0.20
                 + f.avg_importance * 0.20
                 + f.rag_hit_rate   * 0.10
                 + annotation_bonus
                 - overrun_penalty;

    return std::max(0.0, std::min(1.0, score));
}

/// Derive factors from a Trajectory JSON (rl_trajectory_logger::Trajectory::to_json()).
inline QualityFactors from_json(const nlohmann::json& t) {
    QualityFactors f;
    f.tes              = t.value("tes", 0.0);
    f.fidelity_ratio   = t.value("fidelity_ratio", 1.0);
    f.rag_hit_rate     = t.value("rag_hit_rate", 0.0);
    f.annotation_rating = t.value("annotation_rating", 0);
    f.any_overrun      = t.value("any_overrun", false);
    // avg_importance from importance_scores map
    if (t.contains("importance_scores") && t["importance_scores"].is_object()) {
        double sum = 0.0; int n = 0;
        for (const auto& [k, v] : t["importance_scores"].items())
            if (v.is_number()) { sum += v.get<double>(); ++n; }
        if (n > 0) f.avg_importance = sum / n;
    }
    return f;
}

} // namespace trajectory_quality
