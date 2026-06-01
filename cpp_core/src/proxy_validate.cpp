#include "proxy_validate.h"
#include <dirent.h>
#include <fstream>
#include <sys/stat.h>
#include <unistd.h>

static std::string dir_listing(const std::string& dir_path) {
    DIR* d = opendir(dir_path.c_str());
    if (!d) return "(unable to list)";
    std::string out;
    struct dirent* ent;
    int n = 0;
    while ((ent = readdir(d)) != nullptr && n < 8) {
        std::string name(ent->d_name);
        if (name == "." || name == "..") continue;
        if (!out.empty()) out += ", ";
        out += name;
        ++n;
    }
    closedir(d);
    return out.empty() ? "(empty)" : out;
}

// ── MLX validators ────────────────────────────────────────────────────────────

std::string validate_mlx_python(const std::string& interpreter_path) {
    if (interpreter_path.empty())
        return "MLX Python interpreter path is empty. "
               "Set MATRIX_MLX_PYTHON to a conda env with mlx_lm installed "
               "(e.g. ~/miniforge3/envs/mlx-env/bin/python3)";
    if (access(interpreter_path.c_str(), X_OK) != 0)
        return "MLX Python interpreter not found or not executable: " + interpreter_path
             + "\n  Set MATRIX_MLX_PYTHON to a conda env containing mlx_lm "
               "(e.g. ~/miniforge3/envs/mlx-env/bin/python3)";
    return "";
}

std::string validate_mlx_model(const std::string& model_path,
                                const std::string& interpreter_path) {
    std::string err = validate_mlx_python(interpreter_path);
    if (!err.empty()) return err;
    if (model_path.empty()) return "MLX model path is empty";
    bool is_local = (model_path[0] == '/');
    bool is_hf_id = (!is_local && model_path.find('/') != std::string::npos);
    if (!is_local && !is_hf_id)
        return "MLX model path must be an absolute local path: " + model_path
             + "\n  (e.g. /Users/Shared/llama/models/Meta-Llama-3.1-8B-Instruct-4bit)";
    if (is_hf_id)
        return "HuggingFace model IDs are not supported in air-gapped mode: " + model_path
             + "\n  Download the model first and set the path to its local directory"
             + "\n  (e.g. /Users/Shared/llama/models/"
             + model_path.substr(model_path.rfind('/') + 1) + ")";
    struct stat st{};
    if (stat(model_path.c_str(), &st) != 0 || !S_ISDIR(st.st_mode))
        return "MLX model directory not found: " + model_path;
    static const char* REQUIRED[] = {
        "config.json", "tokenizer.json", "tokenizer_config.json", nullptr
    };
    for (int i = 0; REQUIRED[i]; ++i) {
        std::string fp = model_path + "/" + REQUIRED[i];
        if (access(fp.c_str(), R_OK) != 0)
            return "MLX model missing required file '" + std::string(REQUIRED[i])
                 + "': " + model_path
                 + "\n  Directory contents: " + dir_listing(model_path);
    }
    bool has_weights =
        access((model_path + "/model.safetensors").c_str(), R_OK) == 0 ||
        access((model_path + "/model.safetensors.index.json").c_str(), R_OK) == 0;
    if (!has_weights)
        return "MLX model missing weight file (model.safetensors or "
               "model.safetensors.index.json): " + model_path
             + "\n  Directory contents: " + dir_listing(model_path);
    std::ifstream cfg(model_path + "/config.json");
    if (!cfg.is_open())
        return "Cannot open config.json: " + model_path + "/config.json";
    std::string cfg_text((std::istreambuf_iterator<char>(cfg)),
                          std::istreambuf_iterator<char>());
    if (cfg_text.find("\"model_type\"") == std::string::npos)
        return "MLX config.json is not a valid model config (missing 'model_type'): "
             + model_path + "/config.json"
             + "\n  This may not be a converted MLX model directory.";
    return "";
}
