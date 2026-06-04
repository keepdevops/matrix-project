// MS-171 Phase B runtime test: pressure_exceeds_at() — the pure proactive-
// eviction decision. Replaces the source-grep test that asserted the function
// body text (test_ms171b_pressure_exceeds_helper), which would stay green even
// if the logic broke. Here the logic actually executes.

#include "mlx_memory_guard.h"

#include <cassert>
#include <iostream>

using mlx_mem_guard::Config;
using mlx_mem_guard::pressure_exceeds_at;

static Config cfg(bool enabled, int evict_at_pct) {
    Config c;
    c.enabled = enabled;
    c.evict_at_pct = evict_at_pct;
    return c;
}

int main() {
    // total=16, free=2  → used 14/16 = 87% pressure.
    const double total = 16.0, free_hi_pressure = 2.0, free_low_pressure = 12.0;

    // Disabled guard never evicts, regardless of pressure.
    assert(!pressure_exceeds_at(cfg(false, 80), total, free_hi_pressure));

    // evict_at_pct out of (0,100] never evicts (0 = off, >100 = misconfig).
    assert(!pressure_exceeds_at(cfg(true, 0),   total, free_hi_pressure));
    assert(!pressure_exceeds_at(cfg(true, 101), total, free_hi_pressure));

    // Bad telemetry (total<=0) → never evict blindly.
    assert(!pressure_exceeds_at(cfg(true, 80), 0.0,  0.0));
    assert(!pressure_exceeds_at(cfg(true, 80), -1.0, 0.0));

    // 87% pressure ≥ 80% threshold → evict.
    assert(pressure_exceeds_at(cfg(true, 80), total, free_hi_pressure));

    // 25% pressure (free 12/16) < 80% threshold → keep.
    assert(!pressure_exceeds_at(cfg(true, 80), total, free_low_pressure));

    // Boundary: pct exactly == threshold evicts (>= comparison).
    // free=4/16 → used 12/16 = 75% pressure; threshold 75 → evict.
    assert(pressure_exceeds_at(cfg(true, 75), total, 4.0));
    // threshold 76 (one over) → keep.
    assert(!pressure_exceeds_at(cfg(true, 76), total, 4.0));

    std::cout << "\xE2\x9C\x85 test_mlx_mem_guard: all assertions passed\n";
    return 0;
}
