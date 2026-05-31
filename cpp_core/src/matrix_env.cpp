#include "matrix_env.h"
#include <cstdlib>
#include <cstring>
#include <unistd.h>
#include <vector>
#include <string>

MatrixEnv g_env;

static std::string getenv_or(const char* key, std::string def) {
    const char* v = std::getenv(key);
    if (v && v[0]) return std::string(v);
    return def;
}

static int getenv_int(const char* key, int def) {
    const char* v = std::getenv(key);
    if (!v || !v[0]) return def;
    char* end = nullptr;
    long n = std::strtol(v, &end, 10);
    if (end == v || *end) return def;
    return static_cast<int>(n);
}

static bool file_exists(const std::string& p) {
    return access(p.c_str(), F_OK) == 0;
}

void matrix_env_init(const std::string& project_root) {
#ifdef __APPLE__
    const char* def_model = "/Users/Shared/llama/models";
    const char* def_llama = "/Users/Shared/llama/llama-server";
#else
    const char* def_model = "/opt/matrix/models";
    const char* def_llama = "/usr/local/bin/llama-server";
#endif

    g_env.model_dir = getenv_or("MATRIX_MODEL_DIR", def_model);
    g_env.llama_server_bin = getenv_or("MATRIX_LLAMA_SERVER", def_llama);
    g_env.active_config_path = getenv_or("MATRIX_ACTIVE_CONFIG", "/tmp/matrix-active-config.json");
    g_env.matrix_slots_dir = getenv_or("MATRIX_SLOTS_DIR", "/tmp/matrix-slots");

    std::string mlx_from_env = getenv_or("MATRIX_MLX_PYTHON", "");
    if (!mlx_from_env.empty()) {
        g_env.mlx_python = mlx_from_env;
    } else {
        // Search common conda roots for any env containing mlx_lm.
        // Priority: matrix-mlx > mlx-env > mlx across all known conda roots.
        std::string home = getenv_or("HOME", "/root");
        std::vector<std::string> roots = {
            home + "/miniforge3", home + "/mambaforge",
            home + "/miniconda3", home + "/anaconda3",
            "/opt/homebrew/Caskroom/miniforge/base", "/opt/conda",
        };
        std::vector<std::string> env_names = {"matrix-mlx", "mlx-env", "mlx"};
        bool found = false;
        for (const auto& root : roots) {
            for (const auto& env : env_names) {
                std::string p = root + "/envs/" + env + "/bin/python3";
                if (file_exists(p)) { g_env.mlx_python = p; found = true; break; }
            }
            if (found) break;
        }
        if (!found)
            g_env.mlx_python = getenv_or("PYTHON3", "/usr/bin/python3");
    }

    // vLLM python: prefer explicit env var, then conda env, then system python3
    std::string vllm_from_env = getenv_or("MATRIX_VLLM_PYTHON", "");
    if (!vllm_from_env.empty()) {
        g_env.vllm_python = vllm_from_env;
    } else {
        // Check common conda env locations
        std::vector<std::string> conda_roots = {
            getenv_or("HOME", "/root") + "/miniforge3/envs/matrix-vllm/bin/python3",
            getenv_or("HOME", "/root") + "/mambaforge/envs/matrix-vllm/bin/python3",
            getenv_or("HOME", "/root") + "/miniconda3/envs/matrix-vllm/bin/python3",
            getenv_or("HOME", "/root") + "/anaconda3/envs/matrix-vllm/bin/python3",
            "/opt/conda/envs/matrix-vllm/bin/python3",
        };
        bool found = false;
        for (const auto& p : conda_roots) {
            if (file_exists(p)) { g_env.vllm_python = p; found = true; break; }
        }
        if (!found)
            g_env.vllm_python = getenv_or("PYTHON3", "/usr/bin/python3");
    }

    g_env.proxy_port = getenv_int("MATRIX_PROXY_PORT", 3002);
    g_env.coordinator_port = getenv_int("MATRIX_COORDINATOR_PORT", 8000);
    g_env.python_coord_port = getenv_int("MLX_COORD_PORT", 3003);
}
