#include "proxy_models_scan.h"
#include "proxy_models_scan_impl.h"
#include "matrix_env.h"

#include <algorithm>
#include <dirent.h>
#include <string>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

namespace {

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
        if (models_scan_impl::is_gguf_name(name)) {
            off_t sz = models_scan_impl::gguf_size(p);
            if (sz < 0) continue;
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}, {"size_bytes", sz}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                off_t sz = models_scan_impl::mlx_dir_size(p);
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
        if (models_scan_impl::is_gguf_name(name)) {
            off_t sz = models_scan_impl::gguf_size(p);
            if (sz < 0) continue;
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}, {"size_bytes", sz}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                off_t sz = models_scan_impl::mlx_dir_size(p);
                result.push_back({{"name", name}, {"path", p}, {"backend", "mlx"}, {"size_bytes", sz}});
                result.push_back({{"name", name}, {"path", p}, {"backend", "vllm"}, {"size_bytes", sz}});
            } else {
                scan_dir(p, result);
            }
        }
    }
    return result;
}
