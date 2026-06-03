// MS-160: in-process concurrency efficiency probe.
//
// Decides whether the MS-153 single-stream win (+107%) survives the swarm's
// concurrent multi-agent workload, or whether the shared CPython GIL serialises
// it away. Loads the model once, then runs N generate() calls simultaneously
// through the shared interpreter (each thread manages its own GIL) and reports:
//
//   concurrency speedup  = aggregate(N) / aggregate(1)    [>1 ⇒ real overlap]
//   scaling efficiency   = aggregate(N) / (N × aggregate(1))  [1.0 ⇒ perfect]
//
// Concurrency only materialises if mlx_lm.generate() releases the GIL during
// Metal compute. A flat speedup (~1.0) means the GIL fully serialises → the
// in-process design loses the cross-process parallelism the HTTP path gets free.
//
//   ./mlx_concurrency_probe [model_path] [max_tokens]
//
// Env: MLX_ENV_PREFIX. Exit: 0 ok, 1 fail.
#ifdef MATRIX_MLX_EMBED

#include "mlx_embed.h"
#include "mlx_embed_generate.h"

#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

static const char* DEFAULT_MODEL =
    "/Users/caribou/llama-models/Llama-3.2-3B-Instruct-4bit";
static const char* DEFAULT_PROMPT =
    "Briefly explain what a transformer neural network is.";

int main(int argc, char** argv) {
    const std::string model = (argc >= 2) ? argv[1] : DEFAULT_MODEL;
    const int max_tokens    = (argc >= 3) ? std::atoi(argv[2]) : 80;
    const std::vector<int> sweep = {1, 2, 4, 8};

    std::cout << "MS-160 in-process concurrency efficiency (GIL under multi-agent load)\n";
    std::cout << "  model      : " << model << "\n";
    std::cout << "  max_tokens : " << max_tokens << "\n";
    std::cout << "  sweep N    : 1, 2, 4, 8\n";
    std::cout << "  prompt     : " << DEFAULT_PROMPT << "\n\n";

    if (!mlx_embed::is_metal_available()) {
        std::cerr << "FAIL: Metal not available\n";
        return 1;
    }
    std::cout << "  device     : " << mlx_embed::device_name() << "\n\n";

    std::cout << std::fixed << std::setprecision(1);

    double agg1 = 0.0;  // aggregate(1) — single-stream baseline
    std::cout << "── Per-N results ────────────────────────────────────\n";
    std::cout << "   N   agg tok/s   per-stream p50/p95   speedup   efficiency   wall ms\n";

    bool ok = true;
    for (int n : sweep) {
        auto r = mlx_embed::concurrency_benchmark(model, DEFAULT_PROMPT, max_tokens, n);
        if (!r.ok) {
            std::cerr << "  N=" << n << " FAIL: " << r.error << "\n";
            ok = false;
            break;
        }
        if (n == 1) agg1 = r.aggregate_tok_s;
        const double speedup = agg1 > 0 ? r.aggregate_tok_s / agg1 : 0.0;
        const double eff     = agg1 > 0 ? r.aggregate_tok_s / (n * agg1) : 0.0;

        std::cout << "  " << std::setw(2) << n
                  << "   " << std::setw(8) << r.aggregate_tok_s
                  << "    " << std::setw(6) << r.per_stream_p50()
                  << "/" << std::setw(6) << r.per_stream_p95()
                  << "      " << std::setw(4) << speedup << "x"
                  << "      " << std::setw(5) << (eff * 100.0) << "%"
                  << "    " << std::setw(7) << r.wall_ms
                  << "   (RSS " << r.rss_mb << " MB)\n";
    }

    if (!ok) return 1;

    std::cout << "\n── Interpretation ───────────────────────────────────\n";
    std::cout << "  speedup(N) = aggregate(N) / aggregate(1):\n";
    std::cout << "    ~N   → near-perfect parallelism (GIL released during Metal)\n";
    std::cout << "    ~1   → GIL fully serialises — in-process loses multi-agent\n";
    std::cout << "           parallelism the HTTP path gets from separate processes\n";
    std::cout << "\n  Decision feeds revised MS-154 (see docs/sprints/MS-160-concurrency-scope.md):\n";
    std::cout << "    speedup(4) high → GO-confirm | mid → CONDITIONAL | ~1 → NO-GO/redesign\n";
    std::cout << "\nPASS — measurement complete\n";
    return 0;
}

#else
#include <iostream>
int main() {
    std::cerr << "FAIL: compiled without MATRIX_MLX_EMBED=1\n";
    return 1;
}
#endif
