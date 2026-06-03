#pragma once
// MS-152: in-process 4B generation spike via CPython embedding.
// Links against libpython3.12.dylib from the mlx-env conda environment and
// calls mlx_lm.load() + mlx_lm.generate() without HTTP round-trips.
//
// Compiled only when MATRIX_MLX_EMBED=1.

#ifdef MATRIX_MLX_EMBED

#include <string>
#include <vector>

namespace mlx_embed {

struct GenerateResult {
    bool        ok          = false;
    int         n_tokens    = 0;
    double      load_ms     = 0.0;   // model load time
    double      elapsed_ms  = 0.0;   // generate() wall time only
    double      tok_s       = 0.0;   // n_tokens / elapsed_s
    std::string output;
    std::string error;
};

// Load model at model_path and generate up to max_tokens tokens for prompt
// using an embedded Python 3.12 interpreter pointing at python_home (the
// conda mlx-env prefix).  Initialises the interpreter on first call; calling
// again re-uses the live interpreter (Py_Finalize is NOT called — safe for
// a spike binary that exits after one run).
GenerateResult generate_via_python(
    const std::string& model_path,
    const std::string& prompt,
    int                max_tokens  = 100,
    const std::string& python_home = "");  // defaults to MLX_ENV_PREFIX env var

// MS-153: load model once, run N warm iterations in the same interpreter so
// cold (iter 0) / warm (iters 1+) / steady-state throughput separate cleanly.
struct BenchResult {
    bool                ok            = false;
    double              load_ms       = 0.0;   // one-time model load
    std::vector<double> iter_tok_s;            // per-iteration throughput
    int                 n_tokens      = 0;     // tokens per iteration
    double              rss_mb        = 0.0;   // resident set after run (in-process footprint)
    double              rss_first_mb  = 0.0;   // MS-161 Phase A: peak RSS after iter 0
    double              rss_last_mb   = 0.0;   // peak RSS after final iter (leak signal)
    bool                deterministic = false; // all iterations produced identical output
    std::string         output;                // last-iteration text (for parity)
    std::string         error;

    double cold()         const { return iter_tok_s.empty() ? 0.0 : iter_tok_s.front(); }
    double steady_state() const;  // median of the warm tail (iters 1..N-1)
};

// Current resident-set size of this process in MB (mach task_info).
double current_rss_mb();

// Load model_path once, then generate `iterations` times for `prompt`.
BenchResult benchmark_via_python(
    const std::string& model_path,
    const std::string& prompt,
    int                max_tokens  = 80,
    int                iterations  = 5,
    const std::string& python_home = "");

// MS-160: concurrency efficiency. Load model once, then run `n_threads`
// generate() calls simultaneously through the shared interpreter, each thread
// managing its own GIL via PyGILState_Ensure/Release. Concurrency only
// materialises if mlx_lm.generate() releases the GIL during Metal compute —
// the efficiency figure (aggregate ÷ n×single) quantifies exactly that.
struct ConcurrencyResult {
    bool                ok              = false;
    int                 n_threads       = 0;
    double              load_ms         = 0.0;
    std::vector<double> per_stream_tok_s;          // each thread's throughput
    double              aggregate_tok_s = 0.0;     // Σ per-stream
    double              wall_ms         = 0.0;     // wall time of the concurrent batch
    int                 n_tokens        = 0;       // tokens generated per stream
    double              rss_mb          = 0.0;
    std::string         error;

    double per_stream_p50() const;
    double per_stream_p95() const;
};

// Run one concurrency level. Warm the model first (single throwaway generate)
// for fair steady-state numbers — caller sweeps n_threads = 1,2,4,8 and
// computes efficiency(N) = aggregate(N) ÷ (N × aggregate(1)).
ConcurrencyResult concurrency_benchmark(
    const std::string& model_path,
    const std::string& prompt,
    int                max_tokens  = 80,
    int                n_threads   = 4,
    const std::string& python_home = "");

} // namespace mlx_embed

#endif // MATRIX_MLX_EMBED
