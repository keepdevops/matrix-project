#pragma once
#include <cstdlib>
#include <dirent.h>
#include <iostream>
#include <string>
#include <sys/stat.h>

namespace models_scan_impl {

constexpr off_t MIN_GGUF_BYTES = 1 * 1024 * 1024;

inline bool is_gguf_name(const std::string& n) {
    return n.size() > 5 && n.compare(n.size() - 5, 5, ".gguf") == 0;
}

inline off_t gguf_size(const std::string& path) {
    struct stat st{};
    if (stat(path.c_str(), &st) != 0) return -1;
    if (!S_ISREG(st.st_mode)) return -1;
    if (st.st_size < MIN_GGUF_BYTES) {
        std::cerr << "⚠️  [scan] skipping stub GGUF (" << st.st_size << " bytes): " << path << std::endl;
        return -1;
    }
    return st.st_size;
}

inline bool is_real_gguf(const std::string& path) { return gguf_size(path) >= 0; }

inline off_t mlx_dir_size(const std::string& dir) {
    off_t total = 0;
    DIR* d = opendir(dir.c_str());
    if (!d) return 0;
    for (struct dirent* e; (e = readdir(d)) != nullptr;) {
        std::string n = e->d_name;
        if (n.size() > 12 && n.compare(n.size() - 12, 12, ".safetensors") == 0) {
            struct stat st{};
            std::string fp = dir + "/" + n;
            if (stat(fp.c_str(), &st) == 0 && S_ISREG(st.st_mode)) total += st.st_size;
        }
    }
    closedir(d);
    return total;
}

}  // namespace models_scan_impl
