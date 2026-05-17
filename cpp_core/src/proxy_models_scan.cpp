#include "proxy_models_scan.h"
#include "matrix_env.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <dirent.h>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

namespace {

bool is_gguf_name(const std::string& n) {
    return n.size() > 5 && n.compare(n.size() - 5, 5, ".gguf") == 0;
}

static constexpr off_t MIN_GGUF_BYTES = 1 * 1024 * 1024;

// Returns file size on success, -1 if invalid/stub.
off_t gguf_size(const std::string& path) {
    struct stat st{};
    if (stat(path.c_str(), &st) != 0) return -1;
    if (!S_ISREG(st.st_mode)) return -1;
    if (st.st_size < MIN_GGUF_BYTES) {
        std::cerr << "⚠️  [scan] skipping stub GGUF (" << st.st_size
                  << " bytes): " << path << std::endl;
        return -1;
    }
    return st.st_size;
}

bool is_real_gguf(const std::string& path) { return gguf_size(path) >= 0; }

// Sum sizes of all *.safetensors files in an MLX model directory.
off_t mlx_dir_size(const std::string& dir) {
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

void scan_dir(const std::string& dir, json& result, int max_depth = 1) {
    DIR* d = opendir(dir.c_str());
    if (!d) return;
    std::vector<std::string> entries;
    for (struct dirent* e; (e = readdir(d)) != nullptr;) {
        std::string n = e->d_name;
        if (n != "." && n != "..") entries.push_back(n);
    }
    closedir(d);
    std::sort(entries.begin(), entries.end());
    for (const auto& name : entries) {
        std::string p = dir + "/" + name;
        if (is_gguf_name(name)) {
            off_t sz = gguf_size(p);
            if (sz < 0) continue;
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}, {"size_bytes", sz}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                off_t sz = mlx_dir_size(p);
                result.push_back({{"name", name}, {"path", p}, {"backend", "mlx"}, {"size_bytes", sz}});
                result.push_back({{"name", name}, {"path", p}, {"backend", "vllm"}, {"size_bytes", sz}});
            } else if (max_depth > 0) {
                scan_dir(p, result, max_depth - 1);
            }
        }
    }
}

} // namespace

void proxy_append_docker_models(json& result) {
    FILE* fp = popen("docker model ls --format '{{.Name}}' 2>/dev/null", "r");
    if (!fp) return;
    char buf[512];
    while (fgets(buf, sizeof(buf), fp)) {
        std::string name = buf;
        while (!name.empty() && (name.back() == '\n' || name.back() == '\r' || name.back() == ' '))
            name.pop_back();
        if (name.empty() || name == "NAME") continue;
        result.push_back({{"name", name}, {"path", name}, {"backend", "docker"}});
    }
    pclose(fp);
}

json proxy_scan_models_from_env() {
    json result = json::array();
    DIR* d = opendir(g_env.model_dir.c_str());
    if (!d) return result;
    std::vector<std::string> entries;
    for (struct dirent* e; (e = readdir(d)) != nullptr;) {
        std::string n = e->d_name;
        if (n != "." && n != "..") entries.push_back(n);
    }
    closedir(d);
    std::sort(entries.begin(), entries.end());
    for (const auto& name : entries) {
        std::string p = g_env.model_dir + "/" + name;
        if (is_gguf_name(name)) {
            off_t sz = gguf_size(p);
            if (sz < 0) continue;
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}, {"size_bytes", sz}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                off_t sz = mlx_dir_size(p);
                result.push_back({{"name", name}, {"path", p}, {"backend", "mlx"}, {"size_bytes", sz}});
                result.push_back({{"name", name}, {"path", p}, {"backend", "vllm"}, {"size_bytes", sz}});
            } else {
                scan_dir(p, result);
            }
        }
    }
    return result;
}
