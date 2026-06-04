#pragma once
// MS-171 Phase A: pre-flight unified-memory guard for MLX stream/submit routes.
// Reads host_memory_snapshot() (macOS vm_statistics64) and rejects requests when
// free unified memory falls below min_free_gb. No-op when disabled or non-Apple.

#include "host_memory.h"
#include "json.hpp"

using json = nlohmann::json;

namespace mlx_mem_guard {

struct Config {
    bool   enabled      = false;
    double min_free_gb  = 2.0;
    int    evict_at_pct = 0;  // >0: proactively evict idle models at this pressure %
};

inline Config load(const nlohmann::json& coordinator_block) {
    Config c;
    if (!coordinator_block.contains("mlx_memory_guard")) return c;
    const auto& b = coordinator_block["mlx_memory_guard"];
    c.enabled      = b.value("enabled",      false);
    c.min_free_gb  = b.value("min_free_gb",  2.0);
    c.evict_at_pct = b.value("evict_at_pct", 0);
    return c;
}

// Returns {ok:true} when guard is disabled or memory is sufficient.
// Returns {ok:false, error, free_gb, threshold_gb} when rejected.
inline json check(const Config& cfg) {
    if (!cfg.enabled)
        return {{"ok", true}};

    const json snap = host_memory_snapshot();
    if (!snap.value("ok", false)) {
        // Can't read memory — fail open (don't block when telemetry is unavailable).
        return {{"ok", true}};
    }

    const double free_gb = snap.value("free_gb", 999.0);
    if (free_gb >= cfg.min_free_gb)
        return {{"ok", true}};

    return {
        {"ok",           false},
        {"error",        "Insufficient unified memory — try again when pressure drops"},
        {"free_gb",      free_gb},
        {"threshold_gb", cfg.min_free_gb},
    };
}

// MS-171 Phase B: PURE eviction decision — given a config and a memory reading,
// should proactive eviction fire? Guard must be enabled, evict_at_pct in (0,100],
// telemetry sane (total>0), and pressure% at/above the mark. No I/O, so it is
// unit-tested directly (tests/cpp/test_mlx_mem_guard.cpp) instead of grep-asserted.
inline bool pressure_exceeds_at(const Config& cfg, double total_gb, double free_gb) {
    if (!cfg.enabled || cfg.evict_at_pct <= 0 || cfg.evict_at_pct > 100)
        return false;
    if (total_gb <= 0.0) return false;
    const int pct = static_cast<int>((1.0 - free_gb / total_gb) * 100.0);
    return pct >= cfg.evict_at_pct;
}

// true when proactive eviction should fire against *live* unified-memory
// pressure. Reads telemetry; false when unavailable (non-Apple builds) so
// callers never evict blindly. Decision delegated to pressure_exceeds_at().
inline bool pressure_exceeds(const Config& cfg) {
    if (!cfg.enabled || cfg.evict_at_pct <= 0 || cfg.evict_at_pct > 100)
        return false;
    const json snap = host_memory_snapshot();
    if (!snap.value("ok", false)) return false;
    return pressure_exceeds_at(cfg, snap.value("total_gb", 0.0),
                                    snap.value("free_gb",  0.0));
}

// Unified-memory section for the /api/mlx/pressure response.
inline json pressure_memory_section() {
    const json snap = host_memory_snapshot();
    if (!snap.value("ok", false)) return nullptr;
    const double total = snap.value("total_gb", 0.0);
    const double free  = snap.value("free_gb",  0.0);
    const double pct   = (total > 0.0) ? (1.0 - free / total) * 100.0 : 0.0;
    return {
        {"total_gb",     total},
        {"used_gb",      snap.value("used_gb", 0.0)},
        {"free_gb",      free},
        {"pressure_pct", static_cast<int>(pct)},
    };
}

}  // namespace mlx_mem_guard
