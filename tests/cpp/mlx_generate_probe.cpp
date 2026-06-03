// MS-152: in-process 4B generate probe.
// Loads a model via CPython-embedded mlx_lm and measures tok/s.
// Compare against the HTTP coordinator baseline from MS-150.
//
//   ./mlx_generate_probe [model_path] [max_tokens]
//
// Env: MLX_ENV_PREFIX — path to the conda mlx-env (default: ~/miniforge3/envs/mlx-env)
// Exit: 0 = ok, 1 = fail
#ifdef MATRIX_MLX_EMBED

#include "mlx_embed.h"
#include "mlx_embed_generate.h"

#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>

static const char* DEFAULT_MODEL =
    "/Users/caribou/llama-models/Llama-3.2-3B-Instruct-4bit";
static const char* DEFAULT_PROMPT =
    "Briefly explain what a transformer neural network is.";
// HTTP baseline from MS-150 (Python mlx_lm.server via coordinator).
static constexpr double HTTP_BASELINE_TOK_S = 56.0;

int main(int argc, char** argv) {
    const std::string model  = (argc >= 2) ? argv[1] : DEFAULT_MODEL;
    const int max_tokens     = (argc >= 3) ? std::atoi(argv[2]) : 80;

    std::cout << "MS-152 in-process generate spike\n";
    std::cout << "  model      : " << model << "\n";
    std::cout << "  max_tokens : " << max_tokens << "\n";
    std::cout << "  prompt     : " << DEFAULT_PROMPT << "\n\n";

    if (!mlx_embed::is_metal_available()) {
        std::cerr << "FAIL: Metal not available\n";
        return 1;
    }
    std::cout << "  device     : " << mlx_embed::device_name() << "\n\n";

    std::cout << "Loading + generating...\n";
    auto r = mlx_embed::generate_via_python(model, DEFAULT_PROMPT, max_tokens);

    if (!r.ok) {
        std::cerr << "FAIL: " << r.error << "\n";
        return 1;
    }

    std::cout << std::fixed << std::setprecision(1);
    std::cout << "\n── Results ─────────────────────────────────────────\n";
    std::cout << "  model load   : " << r.load_ms    << " ms\n";
    std::cout << "  generate     : " << r.elapsed_ms << " ms\n";
    std::cout << "  tokens       : " << r.n_tokens   << "\n";
    std::cout << "  tok/s        : " << r.tok_s      << "\n";
    std::cout << "\n── vs HTTP baseline ─────────────────────────────────\n";
    const double delta_pct = (r.tok_s - HTTP_BASELINE_TOK_S)
                             / HTTP_BASELINE_TOK_S * 100.0;
    std::cout << "  HTTP baseline: " << HTTP_BASELINE_TOK_S << " tok/s\n";
    std::cout << "  in-process   : " << r.tok_s << " tok/s\n";
    std::cout << "  Δ            : " << std::showpos << delta_pct << "% "
              << (delta_pct >= 30.0 ? "→ GO (MS-154 threshold met)"
                                    : (delta_pct >= 0 ? "→ improvement but below 30%"
                                                      : "→ regression — NO GO"))
              << "\n";
    std::cout << "\n── Output ───────────────────────────────────────────\n";
    std::cout << r.output << "\n\nPASS\n";
    return 0;
}

#else
#include <iostream>
int main() {
    std::cerr << "FAIL: compiled without MATRIX_MLX_EMBED=1\n";
    return 1;
}
#endif
