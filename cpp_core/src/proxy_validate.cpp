#include "proxy_validate.h"
#include <fstream>
#include <cstdint>
#include <cstring>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

// ── Rule 1: file existence ────────────────────────────────────────────────────

std::string validate_model_exists(const std::string& path) {
    if (path.empty())
        return "Model path is empty";
    if (access(path.c_str(), R_OK) != 0)
        return "Model file not found or not readable: " + path;
    return "";
}

// ── Rule 2: GGUF magic bytes ──────────────────────────────────────────────────

// Returns a human-readable hint for non-GGUF formats based on their magic bytes.
static std::string format_hint(const unsigned char* buf, size_t n) {
    if (n >= 8) {
        // safetensors: JSON object {"  →  first byte '{'
        if (buf[0] == '{') return "safetensors or JSON";
        // PyTorch pickle: starts with \x80\x02 or \x80\x04 (protocol 2/4)
        if (buf[0] == 0x80 && (buf[1] == 0x02 || buf[1] == 0x04)) return "PyTorch pickle";
        // HDF5 (Keras, some HF checkpoints): 0x89 H D F
        if (buf[0] == 0x89 && buf[1] == 'H' && buf[2] == 'D' && buf[3] == 'F') return "HDF5";
        // "Acce" seen in practice: likely an HTTP/partial download artifact
        if (buf[0] == 'A' && buf[1] == 'c' && buf[2] == 'c' && buf[3] == 'e') return "not GGUF (starts 'Acce' — likely safetensors header or corrupted download)";
    }
    return "unknown format";
}

std::string validate_gguf_magic(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open())
        return "Cannot open model file: " + path;

    unsigned char buf[8] = {};
    f.read(reinterpret_cast<char*>(buf), sizeof(buf));
    if (f.gcount() < 4)
        return "Model file too small to be a valid GGUF: " + path;

    static const unsigned char GGUF_MAGIC[4] = {'G', 'G', 'U', 'F'};
    if (memcmp(buf, GGUF_MAGIC, 4) != 0) {
        std::string hint = format_hint(buf, static_cast<size_t>(f.gcount()));
        return "Not a valid GGUF file (" + hint + "): " + path
             + "\n  Tip: the correct quantized GGUF may be in the parent directory "
               "(e.g. gemma-2-2b-it-Q4_K_M.gguf rather than models/gemma-2-2b-it.gguf)";
    }
    return "";
}

// ── Rule 3: GGUF general.architecture ────────────────────────────────────────

// Minimal GGUF v3 KV scanner.
// Reads enough of the header to find "general.architecture" without loading the
// full tensor index. Bails out after 64 KiB to avoid stalling on huge files.

static const uint32_t GGUF_TYPE_UINT8   = 0;
static const uint32_t GGUF_TYPE_INT8    = 1;
static const uint32_t GGUF_TYPE_UINT16  = 2;
static const uint32_t GGUF_TYPE_INT16   = 3;
static const uint32_t GGUF_TYPE_UINT32  = 4;
static const uint32_t GGUF_TYPE_INT32   = 5;
static const uint32_t GGUF_TYPE_FLOAT32 = 6;
static const uint32_t GGUF_TYPE_BOOL    = 7;
static const uint32_t GGUF_TYPE_STRING  = 8;
static const uint32_t GGUF_TYPE_ARRAY   = 9;
static const uint32_t GGUF_TYPE_UINT64  = 10;
static const uint32_t GGUF_TYPE_INT64   = 11;
static const uint32_t GGUF_TYPE_FLOAT64 = 12;

// Returns the byte size of a scalar GGUF type (0 = unknown/variable).
static size_t gguf_scalar_size(uint32_t t) {
    switch (t) {
        case GGUF_TYPE_UINT8:
        case GGUF_TYPE_INT8:
        case GGUF_TYPE_BOOL:   return 1;
        case GGUF_TYPE_UINT16:
        case GGUF_TYPE_INT16:  return 2;
        case GGUF_TYPE_UINT32:
        case GGUF_TYPE_INT32:
        case GGUF_TYPE_FLOAT32: return 4;
        case GGUF_TYPE_UINT64:
        case GGUF_TYPE_INT64:
        case GGUF_TYPE_FLOAT64: return 8;
        default: return 0;
    }
}

// Read a GGUF string: u64 length + bytes (no null terminator in file).
static bool read_gguf_string(std::ifstream& f, std::string& out, size_t budget) {
    uint64_t len = 0;
    if (!f.read(reinterpret_cast<char*>(&len), 8)) return false;
    if (len > budget || len > 65536) return false;
    out.resize(static_cast<size_t>(len));
    return static_cast<bool>(f.read(&out[0], static_cast<std::streamsize>(len)));
}

// Skip a KV value of the given type without decoding it.
static bool skip_gguf_value(std::ifstream& f, uint32_t type, size_t budget) {
    if (type == GGUF_TYPE_STRING) {
        std::string ignored;
        return read_gguf_string(f, ignored, budget);
    }
    if (type == GGUF_TYPE_ARRAY) {
        uint32_t elem_type = 0;
        uint64_t count = 0;
        if (!f.read(reinterpret_cast<char*>(&elem_type), 4)) return false;
        if (!f.read(reinterpret_cast<char*>(&count), 8)) return false;
        for (uint64_t i = 0; i < count && i < 65536; ++i) {
            if (!skip_gguf_value(f, elem_type, budget)) return false;
        }
        return true;
    }
    size_t sz = gguf_scalar_size(type);
    if (sz == 0) return false;  // unknown type — bail out safely
    f.ignore(static_cast<std::streamsize>(sz));
    return f.good();
}

std::string validate_gguf_architecture(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open())
        return "Cannot open model file: " + path;

    // Skip magic (4) + version (4) + tensor_count (8) = 16 bytes
    f.ignore(16);
    uint64_t kv_count = 0;
    if (!f.read(reinterpret_cast<char*>(&kv_count), 8))
        return "Truncated GGUF header: " + path;

    static const size_t MAX_SCAN = 65536;  // bail after 64 KiB
    for (uint64_t i = 0; i < kv_count; ++i) {
        if (static_cast<size_t>(f.tellg()) > MAX_SCAN) break;

        std::string key;
        if (!read_gguf_string(f, key, MAX_SCAN)) break;

        uint32_t val_type = 0;
        if (!f.read(reinterpret_cast<char*>(&val_type), 4)) break;

        if (key == "general.architecture") {
            if (val_type != GGUF_TYPE_STRING)
                return "general.architecture is not a string in: " + path;
            std::string arch;
            if (!read_gguf_string(f, arch, MAX_SCAN))
                return "Failed to read general.architecture value in: " + path;
            if (arch.empty())
                return "GGUF model has no text architecture (general.architecture is empty): " + path
                     + "\n  This model is likely a diffusion/image model (e.g. Flux, Stable Diffusion) "
                       "and cannot be served by llama-server. Use a text model or remove this agent.";
            return "";  // architecture present and non-empty — OK
        }

        // Not the key we want — skip the value and continue
        if (!skip_gguf_value(f, val_type, MAX_SCAN)) break;
    }

    // "general.architecture" not found in first 64 KiB — treat as unsupported
    return "GGUF model is missing general.architecture metadata: " + path
         + "\n  This may be a non-text model (diffusion, audio, embeddings). "
           "Verify this is a text/chat GGUF before adding it to the swarm config.";
}

// ── Combined llama validator ──────────────────────────────────────────────────

std::string validate_llama_model(const std::string& path) {
    std::string err;
    if (!(err = validate_model_exists(path)).empty())      return err;
    if (!(err = validate_gguf_magic(path)).empty())        return err;
    if (!(err = validate_gguf_architecture(path)).empty()) return err;
    return "";
}

// ── MLX validators ────────────────────────────────────────────────────────────

// Rule 1: Python interpreter is executable
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

// Returns the first 8 entries of a directory as a comma-separated string (for error context).
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

// Rules 2–4: directory exists, required files present, config.json is a model config.
std::string validate_mlx_model(const std::string& model_path,
                                const std::string& interpreter_path) {
    // Rule 1: interpreter
    std::string err = validate_mlx_python(interpreter_path);
    if (!err.empty()) return err;

    // Rule 2: path classification
    if (model_path.empty())
        return "MLX model path is empty";

    bool is_local = (model_path[0] == '/');
    bool is_hf_id = (!is_local && model_path.find('/') != std::string::npos);

    if (!is_local && !is_hf_id)
        return "MLX model path must be an absolute local path: " + model_path
             + "\n  (e.g. /Users/Shared/llama/models/Meta-Llama-3.1-8B-Instruct-4bit)";

    // HuggingFace IDs require internet access — reject in air-gapped mode
    if (is_hf_id)
        return "HuggingFace model IDs are not supported in air-gapped mode: " + model_path
             + "\n  Download the model first and set the path to its local directory"
             + "\n  (e.g. /Users/Shared/llama/models/"
             + model_path.substr(model_path.rfind('/') + 1) + ")";

    // Rule 2 (local): directory must exist
    struct stat st{};
    if (stat(model_path.c_str(), &st) != 0 || !S_ISDIR(st.st_mode))
        return "MLX model directory not found: " + model_path;

    // Rule 3: required files
    static const char* REQUIRED[] = {
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        nullptr
    };
    for (int i = 0; REQUIRED[i]; ++i) {
        std::string fp = model_path + "/" + REQUIRED[i];
        if (access(fp.c_str(), R_OK) != 0)
            return "MLX model missing required file '" + std::string(REQUIRED[i])
                 + "': " + model_path
                 + "\n  Directory contents: " + dir_listing(model_path);
    }
    // Weights: accept single-file or sharded layout
    bool has_weights =
        access((model_path + "/model.safetensors").c_str(), R_OK) == 0 ||
        access((model_path + "/model.safetensors.index.json").c_str(), R_OK) == 0;
    if (!has_weights)
        return "MLX model missing weight file (model.safetensors or "
               "model.safetensors.index.json): " + model_path
             + "\n  Directory contents: " + dir_listing(model_path);

    // Rule 4: config.json must be valid JSON with a "model_type" key
    std::ifstream cfg(model_path + "/config.json");
    if (!cfg.is_open())
        return "Cannot open config.json: " + model_path + "/config.json";
    std::string cfg_text((std::istreambuf_iterator<char>(cfg)),
                          std::istreambuf_iterator<char>());
    // Minimal check: look for "model_type" without pulling in a full JSON library here
    if (cfg_text.find("\"model_type\"") == std::string::npos)
        return "MLX config.json is not a valid model config (missing 'model_type'): "
             + model_path + "/config.json"
             + "\n  This may not be a converted MLX model directory.";

    return "";
}

// ── vLLM validators ───────────────────────────────────────────────────────────

// Read the integer value of a JSON key using simple string scan (no full parser needed).
// Returns -1 if the key is not found or its value is not a positive integer.
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

static bool ends_with(const std::string& s, const char* suffix) {
    size_t sl = strlen(suffix);
    return s.size() >= sl && s.compare(s.size() - sl, sl, suffix) == 0;
}

std::string validate_vllm_model(const std::string& model_path,
                                 const std::string& interpreter_path,
                                 int context_window) {
    // Rule 1: interpreter executable
    if (interpreter_path.empty() || access(interpreter_path.c_str(), X_OK) != 0)
        return "vLLM Python interpreter not found or not executable: " + interpreter_path
             + "\n  Set MATRIX_VLLM_PYTHON to a conda env containing vllm"
               "\n  (e.g. ~/miniforge3/envs/matrix-vllm/bin/python3)";

    // Rule 2: reject HF IDs (air-gapped)
    if (model_path.empty() || model_path[0] != '/')
        return "HuggingFace model IDs are not supported in air-gapped mode: " + model_path
             + "\n  Download the model first and set the path to its local directory"
             + "\n  (e.g. /Users/Shared/llama/models/"
             + model_path.substr(model_path.rfind('/') + 1) + ")";

    // Rule 3: not a GGUF file (wrong backend) — check before stat so the error
    // is specific rather than "directory not found" for a file path
    if (ends_with(model_path, ".gguf"))
        return "vLLM does not support GGUF files: " + model_path
             + "\n  vLLM requires HuggingFace-format safetensors weights."
               "\n  To use this model with llama-server, set backend to 'llama'.";

    // Rule 4: directory exists
    struct stat st{};
    if (stat(model_path.c_str(), &st) != 0 || !S_ISDIR(st.st_mode))
        return "vLLM model directory not found: " + model_path;

    // Rule 5: required files
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

    // Rule 6: context <= max_position_embeddings
    if (context_window > 0) {
        std::ifstream cfg(model_path + "/config.json");
        if (cfg.is_open()) {
            std::string cfg_text((std::istreambuf_iterator<char>(cfg)),
                                  std::istreambuf_iterator<char>());
            int max_pos = scan_json_int(cfg_text.c_str(), "max_position_embeddings");
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

// ── docker-vllm validator ─────────────────────────────────────────────────────

std::string validate_docker_vllm_model(const std::string& model_id) {
    // Rule 1: model field non-empty
    if (model_id.empty())
        return "docker-vllm agent requires a non-empty model field"
               "\n  (e.g. meta-llama/Llama-3.2-3B-Instruct)";

    // Rule 2: docker binary accessible
    static const char* DOCKER_PATHS[] = {
        "/usr/local/bin/docker",
        "/usr/bin/docker",
        "/opt/homebrew/bin/docker",
        nullptr
    };
    for (int i = 0; DOCKER_PATHS[i]; ++i) {
        if (access(DOCKER_PATHS[i], X_OK) == 0) return "";
    }
    return "docker binary not found. Install Docker Desktop or ensure docker is in PATH."
           "\n  Checked: /usr/local/bin/docker, /usr/bin/docker, /opt/homebrew/bin/docker";
}
