#ifdef MATRIX_MLX_EMBED
// MS-151: MLX C++ embed wrapper — compiled only with MATRIX_MLX_EMBED=1.
// Thin probe layer; no coordinator coupling.

#include "mlx_embed.h"

#include <mlx/mlx.h>
#include <mlx/backend/metal/metal.h>

#include <chrono>
#include <sstream>
#include <stdexcept>

namespace mx = mlx::core;

namespace mlx_embed {

// ── Availability ─────────────────────────────────────────────────────────────

bool is_metal_available() {
    return mlx::core::metal::is_available();
}

std::string device_name() {
    if (!is_metal_available()) return "(Metal unavailable)";
    try {
        // mlx::core::device_info returns variant<string, size_t>
        const auto& info = mx::device_info(mx::Device(mx::Device::gpu));
        auto it = info.find("device_name");
        if (it != info.end()) {
            if (auto* s = std::get_if<std::string>(&it->second))
                return *s;
        }
        return "(unknown device)";
    } catch (const std::exception& e) {
        return std::string("(error: ") + e.what() + ")";
    }
}

// ── Probe ─────────────────────────────────────────────────────────────────────

ProbeResult probe_matmul(int n) {
    ProbeResult out;
    out.n = n;

    if (!is_metal_available()) {
        out.error = "Metal not available on this device";
        return out;
    }

    try {
        // Use the GPU stream explicitly
        auto gpu = mx::Device(mx::Device::gpu);
        auto s   = mx::new_stream(gpu);

        // Allocate two random float32 matrices on GPU
        // uniform(low, high, shape, dtype, key, stream)
        auto a = mx::random::uniform(0.0f, 1.0f, mx::Shape{n, n},
                                     mx::float32, std::nullopt, s);
        auto b = mx::random::uniform(0.0f, 1.0f, mx::Shape{n, n},
                                     mx::float32, std::nullopt, s);
        // Warm-up: one eval before timing to prime Metal pipelines
        auto warm = mx::matmul(a, b, s);
        mx::eval(warm);

        // Timed run
        auto t0 = std::chrono::steady_clock::now();
        auto c  = mx::matmul(a, b, s);
        mx::eval(c);
        auto t1 = std::chrono::steady_clock::now();

        out.elapsed_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
        // FP32 matmul: 2 * n^3 FLOPs
        double flops = 2.0 * static_cast<double>(n) * n * n;
        out.gflops   = flops / (out.elapsed_ms * 1e-3) / 1e9;
        out.ok       = true;
    } catch (const std::exception& e) {
        out.error = e.what();
    }

    return out;
}

} // namespace mlx_embed

#endif // MATRIX_MLX_EMBED
