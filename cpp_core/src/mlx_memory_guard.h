#pragma once
// MS-171 Phase A: pre-flight unified-memory guard for MLX stream/submit routes.
// Reads host_memory_snapshot() (macOS vm_statistics64) and rejects requests when
// free unified memory falls below min_free_gb. No-op when disabled or non-Apple.

#include "host_memory.h"
#include "json.hpp"

using json = nlohmann::json;

namespace mlx_mem_guard {

struct Config {
    bool   enabled     = false;
    double min_free_gb = 2.0;
};

inline Config load(const nlohmann::json& coordinator_block) {
    Config c;
    if (!coordinator_block.contains("mlx_memory_guard")) return c;
    const auto& b = coordinator_block["mlx_memory_guard"];
    c.enabled     = b.value("enabled",     false);
    c.min_free_gb = b.value("min_free_gb", 2.0);
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
