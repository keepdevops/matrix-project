// MS-151: MLX embed probe — verifies CMake build, dylib linkage, and Metal
// availability.  Not a unit test; run manually after build_mlx_embed.sh.
//
//   ./mlx_embed_probe [matrix_size]   (default: 512)
//
// Exit codes: 0 = Metal available + matmul succeeded
//             1 = build issue or Metal unavailable
#ifdef MATRIX_MLX_EMBED

#include "mlx_embed.h"

#include <cstdlib>
#include <iomanip>
#include <iostream>

int main(int argc, char** argv) {
    int n = (argc >= 2) ? std::atoi(argv[1]) : 512;
    if (n <= 0 || n > 8192) { std::cerr << "n must be 1–8192\n"; return 1; }

    std::cout << "MS-151 MLX embed probe\n";
    std::cout << "  Metal available : " << (mlx_embed::is_metal_available() ? "yes" : "NO") << "\n";
    std::cout << "  Device          : " << mlx_embed::device_name() << "\n";

    if (!mlx_embed::is_metal_available()) {
        std::cerr << "FAIL: Metal not available — cannot proceed to MS-152\n";
        return 1;
    }

    std::cout << "  Running " << n << "x" << n << " float32 matmul probe...\n";
    auto r = mlx_embed::probe_matmul(n);

    if (!r.ok) {
        std::cerr << "FAIL: matmul probe error: " << r.error << "\n";
        return 1;
    }

    std::cout << std::fixed << std::setprecision(2)
              << "  elapsed         : " << r.elapsed_ms  << " ms\n"
              << "  throughput      : " << r.gflops      << " GFLOPS\n"
              << "PASS: Metal embed probe succeeded — proceed to MS-152\n";
    return 0;
}

#else
#include <iostream>
int main() {
    std::cerr << "FAIL: compiled without MATRIX_MLX_EMBED=1\n";
    return 1;
}
#endif
