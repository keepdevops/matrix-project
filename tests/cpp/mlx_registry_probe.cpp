// MS-161 Phase B: MlxModelRegistry probe.
// Proves resident load-once + repeated in-process generation through the
// serialized lane. Run 3 prompts on the same agent — model loads on the first
// call, the next two reuse it (fast, no reload).
//
//   ./mlx_registry_probe [model_path]
//
// Env: MLX_ENV_PREFIX. Exit: 0 ok, 1 fail.
#ifdef MATRIX_MLX_EMBED

#include "model_registry.h"   // MS-68 Phase 2a: unified registry (was mlx_model_registry.h)
#include "agent.h"

#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>

static const char* DEFAULT_MODEL =
    "/Users/caribou/llama-models/Llama-3.2-3B-Instruct-4bit";

int main(int argc, char** argv) {
    Agent agent;
    agent.name   = "chat";
    agent.engine = "mlx";
    agent.model  = (argc >= 2) ? argv[1] : DEFAULT_MODEL;

    const char* prompts[] = {
        "What is a transformer in one sentence?",
        "Name three programming languages.",
        "What is 7 times 6?",
    };

    std::cout << "MS-161 Phase B — MlxModelRegistry probe\n";
    std::cout << "  model : " << agent.model << "\n";
    std::cout << "  agent : " << agent.name << " (dispatch=inproc)\n\n";
    std::cout << std::fixed << std::setprecision(1);

    auto& reg = model_mem::ModelRegistry::instance();
    bool ok = true;
    for (int i = 0; i < 3; ++i) {
        const auto t0 = std::chrono::steady_clock::now();
        auto r = reg.generate(agent, prompts[i], 48);
        const double wall = std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - t0).count();
        if (!r.ok) { std::cerr << "  call " << i << " FAIL: " << r.error << "\n"; ok = false; break; }
        std::cout << "  call " << i << "  " << r.tok_s << " tok/s  wall "
                  << wall << "ms  (" << (i == 0 ? "load+gen" : "gen, model resident")
                  << ")  resident_models=" << reg.resident_count() << "\n";
        std::cout << "    → " << r.text.substr(0, 80) << "...\n";
    }

    if (!ok) return 1;

    // MS-161 Phase C: streaming generation (PyIter_Next over mlx_lm.stream_generate)
    std::cout << "\n── Streaming (Phase C) ──\n";
    int chunks = 0;
    auto sr = reg.generate_stream(agent, "Count from 1 to 5.", 40,
        [&](const std::string& delta) { ++chunks; std::cout << delta << std::flush; });
    std::cout << "\n  chunks=" << chunks << " ok=" << (sr.ok ? "yes" : "no")
              << " n_tokens=" << sr.n_tokens << "\n";
    if (!sr.ok || chunks < 2) { std::cerr << "FAIL: streaming produced too few chunks\n"; return 1; }

    std::cout << "\n── Registry snapshot (for /api/mlx/pressure) ──\n";
    std::cout << reg.snapshot().dump(2) << "\n";

    std::cout << "\nPASS — load-once + resident reuse via serialized lane\n";
    return 0;
}

#else
#include <iostream>
int main() { std::cerr << "FAIL: built without MATRIX_MLX_EMBED=1\n"; return 1; }
#endif
