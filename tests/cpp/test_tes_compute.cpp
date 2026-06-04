// MS-70/72 runtime test: tes::compute() / compute_rich() — the Token Efficiency
// Score math. Replaces the source-grep that only checked dispatch_meta *mentions*
// tes::compute; here the weighting actually runs, so a broken score is caught.

#include "tes.h"

#include <cassert>
#include <cmath>
#include <iostream>

static bool approx(double a, double b) { return std::fabs(a - b) < 1e-9; }

int main() {
    using tes::TesFactors;
    using tes::compute;
    using tes::compute_rich;

    // ── compute_rich: density*0.4 + fidelity*0.3 + importance*0.2 + rag*0.1 ──
    // Saturated density (100 tok / 100ms; target 0.5 tok/ms → ratio 2 → clamp 1).
    {
        TesFactors f;
        f.consumed_tokens = 100; f.wall_ms = 100;
        f.fidelity_ratio = 1.0; f.avg_importance = 0.5; f.rag_hit_rate = 0.0;
        // 1.0*0.4 + 1.0*0.3 + 0.5*0.2 + 0.0*0.1 = 0.8
        assert(approx(compute_rich(f), 0.8));
    }
    // Sub-target density (10 tok / 100ms → 0.2).
    {
        TesFactors f;
        f.consumed_tokens = 10; f.wall_ms = 100;
        f.fidelity_ratio = 1.0; f.avg_importance = 0.5; f.rag_hit_rate = 0.0;
        // 0.2*0.4 + 0.3 + 0.1 = 0.48
        assert(approx(compute_rich(f), 0.48));
    }
    // All factors maxed → clamps to exactly 1.0.
    {
        TesFactors f;
        f.consumed_tokens = 100; f.wall_ms = 100;
        f.fidelity_ratio = 1.0; f.avg_importance = 1.0; f.rag_hit_rate = 1.0;
        assert(approx(compute_rich(f), 1.0));
    }
    // Insufficient data → 0.0.
    {
        TesFactors z;  // wall_ms=0, consumed=0
        assert(approx(compute_rich(z), 0.0));
        TesFactors nowall; nowall.consumed_tokens = 50; nowall.wall_ms = 0;
        assert(approx(compute_rich(nowall), 0.0));
    }

    // ── compute(meta): legacy envelope → rich path ──────────────────────────
    // Non-object / missing fields → 0.0.
    assert(approx(compute(nlohmann::json(nullptr)), 0.0));
    assert(approx(compute(nlohmann::json::object()), 0.0));         // no wall_ms
    assert(approx(compute({{"wall_ms", 100}}), 0.0));               // no consumed

    // Full envelope mirrors the 0.8 case above.
    {
        nlohmann::json meta = {
            {"wall_ms", 100},
            {"token_budget", {{"consumed", 100}}},
            {"context_gate", {{"fidelity_ratio", 1.0}}},
            {"avg_importance", 0.5},
        };
        assert(approx(compute(meta), 0.8));
    }
    // With RAG: top_k=4, 2 hits → rag_hit_rate 0.5 → +0.05 → 0.85.
    {
        nlohmann::json meta = {
            {"wall_ms", 100},
            {"token_budget", {{"consumed", 100}}},
            {"context_gate", {{"fidelity_ratio", 1.0}}},
            {"avg_importance", 0.5},
            {"rag", {{"top_k", 4}, {"hits", {"a", "b"}}}},
        };
        assert(approx(compute(meta), 0.85));
    }

    std::cout << "\xE2\x9C\x85 test_tes_compute: all assertions passed\n";
    return 0;
}
