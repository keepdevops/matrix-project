#pragma once
// MS-151: thin C++ wrapper around the MLX core API for the in-process embed
// spike (Darwin arm64 only).  Compiled only when MATRIX_MLX_EMBED=1.
//
// This header is intentionally minimal — it exposes just enough surface to
// verify compilation, dylib linkage, and Metal availability before MS-152
// adds real inference.  No coordinator coupling in this file.

#ifdef MATRIX_MLX_EMBED

#include <string>

namespace mlx_embed {

// ── Availability ─────────────────────────────────────────────────────────────

// Returns true when Metal GPU is active and usable.
bool is_metal_available();

// Human-readable GPU / device name from mlx::core::device_info (e.g. "Apple M3 Pro").
std::string device_name();

// ── Probe ─────────────────────────────────────────────────────────────────────

struct ProbeResult {
    bool    ok          = false;
    int     n           = 0;       // matrix dimension used
    double  elapsed_ms  = 0.0;     // wall time for matmul + eval
    double  gflops      = 0.0;     // 2*n^3 / elapsed_s / 1e9
    std::string error;             // non-empty on failure
};

// Run a single (n × n) × (n × n) float32 matmul on the GPU, synchronously
// eval the result, and return timing stats.  n=256 is fast (~1 ms on M-series);
// n=1024 gives a more stable GFLOPS reading.
ProbeResult probe_matmul(int n = 512);

} // namespace mlx_embed

#endif // MATRIX_MLX_EMBED
