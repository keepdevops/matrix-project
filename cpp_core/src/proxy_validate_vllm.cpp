#include "proxy_validate_vllm.h"
#include <dirent.h>
#include <fstream>
#include <string>
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

static int scan_json_int(const std::string& text, const char* key) {
    std::string needle = std::string("\"") + key + "\"";
    auto pos = text.find(needle);
    if (pos == std::string::npos) return -1;
    pos = text.find(':', pos + needle.size());
    if (pos == std::string::npos) return -1;
    while (++pos < text.size() && (text[pos] == ' ' || text[pos] == '\t')) {}
    if (pos >= text.size() || text[pos] < '0' || text[pos] > '9') return -1;
    return std::stoi(text.substr(pos));
}

static bool ends_with_gguf_ext(const std::string& s) {
    return s.size() > 5 && s.compare(s.size() - 5, 5, ".gguf") == 0;
}

std::string validate_vllm_model(const std::string& model_path,
                                 const std::string& interpreter_path,
                                 int context_window) {
    if (interpreter_path.empty() || access(interpreter_path.c_str(), X_OK) != 0)
        return "vLLM Python interpreter not found or not executable: " + interpreter_path
             + "\n  Set MATRIX_VLLM_PYTHON to a conda env containing vllm"
               "\n  (e.g. ~/miniforge3/envs/matrix-vllm/bin/python3)";
    if (model_path.empty() || model_path[0] != '/')
        return "HuggingFace model IDs are not supported in air-gapped mode: " + model_path
             + "\n  Download the model first and set the path to its local directory"
             + "\n  (e.g. /Users/Shared/llama/models/"
             + model_path.substr(model_path.rfind('/') + 1) + ")";
    if (ends_with_gguf_ext(model_path))
        return "vLLM does not support GGUF files: " + model_path
             + "\n  vLLM requires HuggingFace-format safetensors weights."
               "\n  To use this model with llama-server, set backend to 'llama'.";
    struct stat st{};
    if (stat(model_path.c_str(), &st) != 0 || !S_ISDIR(st.st_mode))
        return "vLLM model directory not found: " + model_path;
    if (access((model_path + "/config.json").c_str(), R_OK) != 0)
        return "vLLM model missing required file 'config.json': " + model_path
             + "\n  Directory contents: " + dir_listing(model_path);
    bool has_weights =
        access((model_path + "/model.safetensors").c_str(), R_OK) == 0 ||
        access((model_path + "/model.safetensors.index.json").c_str(), R_OK) == 0 ||
        access((model_path + "/pytorch_model.bin").c_str(), R_OK) == 0 ||
        access((model_path + "/pytorch_model.bin.index.json").c_str(), R_OK) == 0;
    if (!has_weights)
        return "vLLM model missing weight file (model.safetensors or pytorch_model.bin): "
             + model_path + "\n  Directory contents: " + dir_listing(model_path);
    bool has_tokenizer =
        access((model_path + "/tokenizer.json").c_str(), R_OK) == 0 ||
        access((model_path + "/tokenizer.model").c_str(), R_OK) == 0;
    if (!has_tokenizer)
        return "vLLM model missing tokenizer (tokenizer.json or tokenizer.model): "
             + model_path + "\n  Directory contents: " + dir_listing(model_path);
    if (context_window > 0) {
        std::ifstream cfg(model_path + "/config.json");
        if (cfg.is_open()) {
            std::string cfg_text((std::istreambuf_iterator<char>(cfg)),
                                  std::istreambuf_iterator<char>());
            int max_pos = scan_json_int(cfg_text, "max_position_embeddings");
            if (max_pos > 0 && context_window > max_pos)
                return "Agent context " + std::to_string(context_window)
                     + " exceeds model's max_position_embeddings "
                     + std::to_string(max_pos) + ": " + model_path + "/config.json"
                     + "\n  Set 'context' to " + std::to_string(max_pos)
                     + " or lower to avoid vLLM startup OOM.";
        }
    }
    return "";
}

std::string validate_docker_vllm_model(const std::string& model_id) {
    if (model_id.empty())
        return "docker-vllm agent requires a non-empty model field"
               "\n  (e.g. meta-llama/Llama-3.2-3B-Instruct)";
    static const char* DOCKER_PATHS[] = {
        "/usr/local/bin/docker", "/usr/bin/docker", "/opt/homebrew/bin/docker", nullptr
    };
    for (int i = 0; DOCKER_PATHS[i]; ++i) {
        if (access(DOCKER_PATHS[i], X_OK) == 0) return "";
    }
    return "docker binary not found. Install Docker Desktop or ensure docker is in PATH."
           "\n  Checked: /usr/local/bin/docker, /usr/bin/docker, /opt/homebrew/bin/docker";
}
