#pragma once
#include <cstdint>
#include <cstring>
#include <fstream>
#include <string>

namespace gguf_impl {

static const uint32_t TYPE_UINT8   = 0, TYPE_INT8    = 1, TYPE_UINT16  = 2;
static const uint32_t TYPE_INT16   = 3, TYPE_UINT32  = 4, TYPE_INT32   = 5;
static const uint32_t TYPE_FLOAT32 = 6, TYPE_BOOL    = 7, TYPE_STRING  = 8;
static const uint32_t TYPE_ARRAY   = 9, TYPE_UINT64  = 10, TYPE_INT64  = 11;
static const uint32_t TYPE_FLOAT64 = 12;

inline std::string format_hint(const unsigned char* buf, size_t n) {
    if (n >= 8) {
        if (buf[0] == '{') return "safetensors or JSON";
        if (buf[0] == 0x80 && (buf[1] == 0x02 || buf[1] == 0x04)) return "PyTorch pickle";
        if (buf[0] == 0x89 && buf[1] == 'H' && buf[2] == 'D' && buf[3] == 'F') return "HDF5";
        if (buf[0] == 'A' && buf[1] == 'c' && buf[2] == 'c' && buf[3] == 'e')
            return "not GGUF (starts 'Acce' — likely safetensors header or corrupted download)";
    }
    return "unknown format";
}

inline size_t scalar_size(uint32_t t) {
    switch (t) {
        case TYPE_UINT8: case TYPE_INT8: case TYPE_BOOL:   return 1;
        case TYPE_UINT16: case TYPE_INT16:                  return 2;
        case TYPE_UINT32: case TYPE_INT32: case TYPE_FLOAT32: return 4;
        case TYPE_UINT64: case TYPE_INT64: case TYPE_FLOAT64: return 8;
        default: return 0;
    }
}

inline bool read_string(std::ifstream& f, std::string& out, size_t budget) {
    uint64_t len = 0;
    if (!f.read(reinterpret_cast<char*>(&len), 8)) return false;
    if (len > budget || len > 65536) return false;
    out.resize(static_cast<size_t>(len));
    return static_cast<bool>(f.read(&out[0], static_cast<std::streamsize>(len)));
}

inline bool skip_value(std::ifstream& f, uint32_t type, size_t budget) {
    if (type == TYPE_STRING) {
        std::string ignored;
        return read_string(f, ignored, budget);
    }
    if (type == TYPE_ARRAY) {
        uint32_t elem_type = 0; uint64_t count = 0;
        if (!f.read(reinterpret_cast<char*>(&elem_type), 4)) return false;
        if (!f.read(reinterpret_cast<char*>(&count), 8)) return false;
        for (uint64_t i = 0; i < count && i < 65536; ++i)
            if (!skip_value(f, elem_type, budget)) return false;
        return true;
    }
    size_t sz = scalar_size(type);
    if (sz == 0) return false;
    f.ignore(static_cast<std::streamsize>(sz));
    return f.good();
}

}  // namespace gguf_impl
