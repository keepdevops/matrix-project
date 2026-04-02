#include "matrix_env.h"
#include <cstdlib>
#include <cstring>
#include <unistd.h>

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
        std::string pixi_mlx = project_root + "/.pixi/envs/mlx/bin/python3";
        if (file_exists(pixi_mlx))
            g_env.mlx_python = pixi_mlx;
        else
            g_env.mlx_python = getenv_or("PYTHON3", "/usr/bin/python3");
    }

    g_env.proxy_port = getenv_int("MATRIX_PROXY_PORT", 3002);
    g_env.coordinator_port = getenv_int("MATRIX_COORDINATOR_PORT", 8000);
}
