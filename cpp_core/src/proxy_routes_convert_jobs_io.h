#pragma once
// Inline job persistence helpers — included only by proxy_routes_convert_jobs.cpp.

#include "proxy_routes_convert_jobs.h"
#include "json.hpp"
#include <fstream>
#include <map>
#include <mutex>
#include <string>

namespace convert_io {

using json = nlohmann::json;
static constexpr const char* JOBS_FILE = "/tmp/matrix-convert-jobs.json";

// Caller must hold convert_jobs_mu.
inline void save_jobs(const std::map<std::string, ConvertJob>& jobs) {
    json arr = json::array();
    for (const auto& [id, j] : jobs) {
        arr.push_back({
            {"id",       j.id},
            {"status",   j.status},
            {"step",     j.step},
            {"pct",      j.pct},
            {"output",   j.output},
            {"error",    j.error},
            {"log_path", j.log_path},
        });
    }
    std::string tmp = std::string(JOBS_FILE) + ".tmp";
    std::ofstream f(tmp);
    if (f.is_open()) {
        f << arr.dump();
        f.close();
        std::rename(tmp.c_str(), JOBS_FILE);
    }
}

inline void load_jobs(std::map<std::string, ConvertJob>& jobs, std::mutex& mu) {
    std::ifstream f(JOBS_FILE);
    if (!f.is_open()) return;
    try {
        auto arr = json::parse(f);
        std::lock_guard<std::mutex> lk(mu);
        for (const auto& item : arr) {
            ConvertJob j;
            j.id       = item.value("id",       std::string(""));
            j.status   = item.value("status",   std::string("error"));
            j.step     = item.value("step",     std::string(""));
            j.pct      = item.value("pct",      0);
            j.output   = item.value("output",   std::string(""));
            j.error    = item.value("error",    std::string(""));
            j.log_path = item.value("log_path", std::string(""));
            j.pid      = -1;
            if (!j.id.empty()) jobs[j.id] = std::move(j);
        }
    } catch (...) {}
}

} // namespace convert_io
