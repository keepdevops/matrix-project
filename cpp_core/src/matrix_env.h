#pragma once
#include <string>

/** Runtime paths and ports — set via environment variables (see scripts/matrix-env.sh, .env.example). */
struct MatrixEnv {
    std::string model_dir;
    std::string llama_server_bin;
    std::string active_config_path;
    /** Python interpreter for mlx_lm (full path). */
    std::string mlx_python;
    /** Python interpreter for vllm.entrypoints (full path). */
    std::string vllm_python;
    std::string matrix_slots_dir;
    int proxy_port = 3002;
    int coordinator_port = 8000;
    int python_coord_port = 3003;
};

extern MatrixEnv g_env;

/** Call once at startup after project_root is known (directory containing swarm-config.json). */
void matrix_env_init(const std::string& project_root);
