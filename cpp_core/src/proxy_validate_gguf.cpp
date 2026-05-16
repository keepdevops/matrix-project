#include "proxy_validate.h"
#include <fstream>
#include <cstdint>
#include <cstring>
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

static std::string format_hint(const unsigned char* buf, size_t n) {
    if (n >= 8) {
        if (buf[0] == '{') return "safetensors or JSON";
        if (buf[0] == 0x80 && (buf[1] == 0x02 || buf[1] == 0x04)) return "PyTorch pickle";
        if (buf[0] == 0x89 && buf[1] == 'H' && buf[2] == 'D' && buf[3] == 'F') return "HDF5";
        if (buf[0] == 'A' && buf[1] == 'c' && buf[2] == 'c' && buf[3] == 'e')
            return "not GGUF (starts 'Acce' — likely safetensors header or corrupted download)";
    }
    return "unknown format";
}

std::string validate_gguf_magic(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) return "Cannot open model file: " + path;
    unsigned char buf[8] = {};
    f.read(reinterpret_cast<char*>(buf), sizeof(buf));
    if (f.gcount() < 4) return "Model file too small to be a valid GGUF: " + path;
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

// Minimal GGUF v3 KV scanner — reads just enough header to find
// "general.architecture" without loading the full tensor index.
// Bails out after 64 KiB to avoid stalling on huge files.

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

static size_t gguf_scalar_size(uint32_t t) {
    switch (t) {
        case GGUF_TYPE_UINT8: case GGUF_TYPE_INT8: case GGUF_TYPE_BOOL:   return 1;
        case GGUF_TYPE_UINT16: case GGUF_TYPE_INT16:                       return 2;
        case GGUF_TYPE_UINT32: case GGUF_TYPE_INT32: case GGUF_TYPE_FLOAT32: return 4;
        case GGUF_TYPE_UINT64: case GGUF_TYPE_INT64: case GGUF_TYPE_FLOAT64: return 8;
        default: return 0;
    }
}

static bool read_gguf_string(std::ifstream& f, std::string& out, size_t budget) {
    uint64_t len = 0;
    if (!f.read(reinterpret_cast<char*>(&len), 8)) return false;
    if (len > budget || len > 65536) return false;
    out.resize(static_cast<size_t>(len));
    return static_cast<bool>(f.read(&out[0], static_cast<std::streamsize>(len)));
}

static bool skip_gguf_value(std::ifstream& f, uint32_t type, size_t budget) {
    if (type == GGUF_TYPE_STRING) {
        std::string ignored;
        return read_gguf_string(f, ignored, budget);
    }
    if (type == GGUF_TYPE_ARRAY) {
        uint32_t elem_type = 0; uint64_t count = 0;
        if (!f.read(reinterpret_cast<char*>(&elem_type), 4)) return false;
        if (!f.read(reinterpret_cast<char*>(&count), 8)) return false;
        for (uint64_t i = 0; i < count && i < 65536; ++i) {
            if (!skip_gguf_value(f, elem_type, budget)) return false;
        }
        return true;
    }
    size_t sz = gguf_scalar_size(type);
    if (sz == 0) return false;
    f.ignore(static_cast<std::streamsize>(sz));
    return f.good();
}

std::string validate_gguf_architecture(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f.is_open()) return "Cannot open model file: " + path;
    f.ignore(16);  // magic(4) + version(4) + tensor_count(8)
    uint64_t kv_count = 0;
    if (!f.read(reinterpret_cast<char*>(&kv_count), 8))
        return "Truncated GGUF header: " + path;
    static const size_t MAX_SCAN = 65536;
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
            return "";
        }
        if (!skip_gguf_value(f, val_type, MAX_SCAN)) break;
    }
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
