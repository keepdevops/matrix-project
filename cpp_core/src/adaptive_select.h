#pragma once
// Contract-aware, importance-rewarding adaptive max_select computation.
// Replaces the inline logic in coordinator_routes_dispatch.cpp.

#include <algorithm>
#include <iostream>
#include <string>

namespace adaptive_select {

struct Factors {
    int    base_max_select;
    double kv_pressure;    // 0–1 from frontend KV readings
    bool   any_overrun;    // from ContractLedger::any_overrun()
    double avg_importance; // from last run symbolic scores (0–1); -1 = unknown
};

/// Compute adjusted max_select:
///   overrun | kv > 0.85 → max(1, base-2)
///   kv > 0.70           → max(1, base-1)
///   avg_importance > 0.7 → +1 reward (capped at base+1)
///   otherwise           → base
inline int compute(const Factors& f) {
    int result = f.base_max_select;

    if (f.any_overrun || f.kv_pressure > 0.85)
        result = std::max(1, f.base_max_select - 2);
    else if (f.kv_pressure > 0.70)
        result = std::max(1, f.base_max_select - 1);

    // Reward high importance (only when not already penalised)
    if (result >= f.base_max_select && f.avg_importance > 0.7)
        result = std::min(f.base_max_select + 1, result + 1);

    if (result != f.base_max_select) {
        std::cout << "🎛️  [adaptive_select] " << f.base_max_select << " → " << result
                  << " (kv=" << (int)(f.kv_pressure * 100) << "%"
                  << (f.any_overrun ? " overrun" : "")
                  << (f.avg_importance > 0.7 ? " high-imp" : "") << ")" << std::endl;
    }
    return result;
}

} // namespace adaptive_select
