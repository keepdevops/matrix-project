#pragma once
// MS-152: in-process 4B generation spike via CPython embedding.
// Links against libpython3.12.dylib from the mlx-env conda environment and
// calls mlx_lm.load() + mlx_lm.generate() without HTTP round-trips.
//
// Compiled only when MATRIX_MLX_EMBED=1.

#ifdef MATRIX_MLX_EMBED

#include <string>

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

} // namespace mlx_embed

#endif // MATRIX_MLX_EMBED
