// MS-153: in-process MLX benchmark — cold/warm/steady-state tok/s + RSS + parity.
//
// Loads the model ONCE, then runs N generate iterations in the same embedded
// interpreter so warmup separates cleanly from steady-state. This corrects the
// MS-152 spike, whose single-number result (+51.8%) was a mid-warmup snapshot:
// cold-cache first runs are far slower (a regression vs HTTP), steady-state is
// far faster. The go/no-go gate (MS-154) must rest on steady-state.
//
//   ./mlx_bench_probe [model_path] [max_tokens] [iterations]
//
// Env: MLX_ENV_PREFIX — conda mlx-env (default ~/miniforge3/envs/mlx-env)
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
// HTTP baseline from MS-150 (Python mlx_lm.server via coordinator), warm.
static constexpr double HTTP_BASELINE_TOK_S = 56.0;
// MS-154 go/no-go threshold.
static constexpr double GO_THRESHOLD_PCT = 30.0;

int main(int argc, char** argv) {
    const std::string model = (argc >= 2) ? argv[1] : DEFAULT_MODEL;
    const int max_tokens    = (argc >= 3) ? std::atoi(argv[2]) : 80;
    const int iterations    = (argc >= 4) ? std::atoi(argv[3]) : 6;

    std::cout << "MS-153 in-process benchmark (cold/warm/steady-state + RSS)\n";
    std::cout << "  model      : " << model << "\n";
    std::cout << "  max_tokens : " << max_tokens << "\n";
    std::cout << "  iterations : " << iterations << "\n";
    std::cout << "  prompt     : " << DEFAULT_PROMPT << "\n\n";

    if (!mlx_embed::is_metal_available()) {
        std::cerr << "FAIL: Metal not available\n";
        return 1;
    }
    std::cout << "  device     : " << mlx_embed::device_name() << "\n";
    std::cout << "  RSS (pre)  : " << std::fixed << std::setprecision(1)
              << mlx_embed::current_rss_mb() << " MB\n\n";

    std::cout << "Loading once, running " << iterations << " warm iterations...\n";
    auto r = mlx_embed::benchmark_via_python(model, DEFAULT_PROMPT, max_tokens, iterations);

    if (!r.ok) {
        std::cerr << "FAIL: " << r.error << "\n";
        return 1;
    }

    std::cout << std::fixed << std::setprecision(1);
    if (r.iter_tok_s.size() <= 20) {
        std::cout << "\n── Per-iteration tok/s ──────────────────────────────\n";
        for (size_t i = 0; i < r.iter_tok_s.size(); ++i) {
            std::cout << "  iter " << i << (i == 0 ? " (cold)" : "       ")
                      << " : " << r.iter_tok_s[i] << " tok/s\n";
        }
    } else {
        std::cout << "\n── Soak run: " << r.iter_tok_s.size()
                  << " iterations (per-iter lines suppressed) ──\n";
    }

    const double cold   = r.cold();
    const double steady = r.steady_state();
    std::cout << "\n── Summary ──────────────────────────────────────────\n";
    std::cout << "  model load        : " << r.load_ms << " ms (one-time)\n";
    std::cout << "  tokens/iter       : " << r.n_tokens << "\n";
    std::cout << "  cold (iter 0)     : " << cold   << " tok/s\n";
    std::cout << "  steady-state      : " << steady << " tok/s (median of warm tail)\n";
    std::cout << "  RSS (model loaded): " << r.rss_mb << " MB\n";
    std::cout << "  deterministic     : " << (r.deterministic ? "yes" : "NO") << "\n";

    // MS-161 Phase A: OOM-soak gate — peak-RSS leak check across the run.
    const double rss_growth = r.rss_last_mb - r.rss_first_mb;
    const double rss_growth_pct = r.rss_first_mb > 0 ? rss_growth / r.rss_first_mb * 100.0 : 0.0;
    std::cout << "\n── Phase A: OOM-soak leak check ─────────────────────\n";
    std::cout << "  peak RSS @ iter 0 : " << r.rss_first_mb << " MB\n";
    std::cout << "  peak RSS @ final  : " << r.rss_last_mb  << " MB\n";
    std::cout << "  growth            : " << std::showpos << rss_growth << " MB ("
              << rss_growth_pct << "%)" << std::noshowpos << "\n";
    const bool no_oom = r.ok;  // ok == all iterations completed without crash
    const bool flat   = rss_growth_pct < 10.0;  // <10% peak growth = no leak
    std::cout << "  completed no OOM  : " << (no_oom ? "yes" : "NO") << "\n";
    std::cout << "  RSS flat (<10%)   : " << (flat ? "yes" : "NO") << "\n";
    std::cout << "  Phase A gate      : "
              << ((no_oom && flat) ? "PASS — sequential in-process is stable"
                                   : "FAIL — investigate before MS-161 Phase B")
              << "\n";

    std::cout << "\n── vs HTTP baseline (" << HTTP_BASELINE_TOK_S << " tok/s, warm) ──\n";
    auto pct = [](double v) { return (v - HTTP_BASELINE_TOK_S) / HTTP_BASELINE_TOK_S * 100.0; };
    const double cold_pct   = pct(cold);
    const double steady_pct = pct(steady);
    std::cout << std::showpos;
    std::cout << "  cold         : " << cold_pct   << "%"
              << (cold_pct < 0 ? "  (regression — first request is slower)" : "") << "\n";
    std::cout << "  steady-state : " << steady_pct << "%\n";
    std::cout << std::noshowpos;

    std::cout << "\n── MS-154 go/no-go (steady-state ≥ "
              << GO_THRESHOLD_PCT << "%) ──\n";
    const bool go = steady_pct >= GO_THRESHOLD_PCT;
    std::cout << "  decision     : " << (go ? "GO" : "NO GO")
              << "  (steady-state " << std::showpos << steady_pct << std::noshowpos
              << "% vs +" << GO_THRESHOLD_PCT << "% gate)\n";
    if (!r.deterministic)
        std::cout << "  ⚠️  output not deterministic across iterations — investigate before GO\n";

    std::cout << "\n── Output (last iteration) ──────────────────────────\n";
    std::cout << r.output << "\n\n";
    std::cout << (go ? "PASS — GO" : "PASS — measurement complete (NO GO)") << "\n";
    return 0;
}

#else
#include <iostream>
int main() {
    std::cerr << "FAIL: compiled without MATRIX_MLX_EMBED=1\n";
    return 1;
}
#endif
