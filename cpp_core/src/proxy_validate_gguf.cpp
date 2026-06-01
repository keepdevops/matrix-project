#include "proxy_validate.h"
#include "proxy_validate_gguf_impl.h"
#include <unistd.h>

std::string validate_model_exists(const std::string& path) {
    if (path.empty())
        return "Model path is empty";
    if (access(path.c_str(), R_OK) != 0)
        return "Model file not found or not readable: " + path;
    return "";
}

std::string validate_gguf_magic(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) return "Cannot open model file: " + path;
    unsigned char buf[8] = {};
    f.read(reinterpret_cast<char*>(buf), sizeof(buf));
    if (f.gcount() < 4) return "Model file too small to be a valid GGUF: " + path;
    static const unsigned char GGUF_MAGIC[4] = {'G', 'G', 'U', 'F'};
    if (memcmp(buf, GGUF_MAGIC, 4) != 0) {
        std::string hint = gguf_impl::format_hint(buf, static_cast<size_t>(f.gcount()));
        return "Not a valid GGUF file (" + hint + "): " + path
             + "\n  Tip: the correct quantized GGUF may be in the parent directory "
               "(e.g. gemma-2-2b-it-Q4_K_M.gguf rather than models/gemma-2-2b-it.gguf)";
    }
    return "";
}

std::string validate_gguf_architecture(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) return "Cannot open model file: " + path;
    f.ignore(16);
    uint64_t kv_count = 0;
    if (!f.read(reinterpret_cast<char*>(&kv_count), 8))
        return "Truncated GGUF header: " + path;
    static const size_t MAX_SCAN = 65536;
    for (uint64_t i = 0; i < kv_count; ++i) {
        if (static_cast<size_t>(f.tellg()) > MAX_SCAN) break;
        std::string key;
        if (!gguf_impl::read_string(f, key, MAX_SCAN)) break;
        uint32_t val_type = 0;
        if (!f.read(reinterpret_cast<char*>(&val_type), 4)) break;
        if (key == "general.architecture") {
            if (val_type != gguf_impl::TYPE_STRING)
                return "general.architecture is not a string in: " + path;
            std::string arch;
            if (!gguf_impl::read_string(f, arch, MAX_SCAN))
                return "Failed to read general.architecture value in: " + path;
            if (arch.empty())
                return "GGUF model has no text architecture (general.architecture is empty): " + path
                     + "\n  This model is likely a diffusion/image model (e.g. Flux, Stable Diffusion) "
                       "and cannot be served by llama-server. Use a text model or remove this agent.";
            return "";
        }
        if (!gguf_impl::skip_value(f, val_type, MAX_SCAN)) break;
    }
    return "GGUF model is missing general.architecture metadata: " + path
         + "\n  This may be a non-text model (diffusion, audio, embeddings). "
           "Verify this is a text/chat GGUF before adding it to the swarm config.";
}

std::string validate_llama_model(const std::string& path) {
    std::string err;
    if (!(err = validate_model_exists(path)).empty())      return err;
    if (!(err = validate_gguf_magic(path)).empty())        return err;
    if (!(err = validate_gguf_architecture(path)).empty()) return err;
    return "";
}
