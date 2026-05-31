#include "proxy_convert_jobs.h"

#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <fstream>
#include <random>

namespace proxy_convert_jobs {
namespace {

constexpr const char* JOBS_FILE = "/tmp/matrix-convert-jobs.json";

}  // namespace

std::mutex& jobs_mutex() {
    static std::mutex mu;
    return mu;
}

std::map<std::string, ConvertJob>& jobs() {
    static std::map<std::string, ConvertJob> g_jobs;
    return g_jobs;
}

std::string make_job_id() {
    auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    std::mt19937_64 rng(now);
    char buf[32];
    snprintf(buf, sizeof(buf), "cvt_%llx", (unsigned long long)rng());
    return buf;
}

void save_jobs() {
    nlohmann::json arr = nlohmann::json::array();
    for (const auto& [id, j] : jobs()) {
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

void load_jobs() {
    std::ifstream f(JOBS_FILE);
    if (!f.is_open()) return;
    try {
        auto arr = nlohmann::json::parse(f);
        std::lock_guard<std::mutex> lk(jobs_mutex());
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
            if (!j.id.empty()) jobs()[j.id] = std::move(j);
        }
    } catch (...) {}
}

bool refresh_job(ConvertJob& j) {
    if (j.status == "done" || j.status == "error") return false;

    const std::string prev_status = j.status;

    std::ifstream f(j.log_path);
    if (f.is_open()) {
        std::string last, line;
        while (std::getline(f, line))
            if (!line.empty()) last = line;
        if (!last.empty()) {
            try {
                auto parsed = nlohmann::json::parse(last);
                j.status = parsed.value("status", j.status);
                j.step   = parsed.value("step",   j.step);
                j.pct    = parsed.value("pct",    j.pct);
                j.output = parsed.value("output", j.output);
                if (parsed.contains("error")) j.error = parsed["error"].get<std::string>();
            } catch (...) {}
        }
    }

    if (j.status == "running" && j.pid > 0) {
        int wstatus = 0;
        if (waitpid(j.pid, &wstatus, WNOHANG) > 0) {
            j.pid    = -1;
            j.status = "error";
            j.error  = "conversion process exited unexpectedly";
        }
    } else {
        j.pid = -1;
    }

    return j.status != prev_status;
}

nlohmann::json job_to_json(ConvertJob& j) {
    if (refresh_job(j)) save_jobs();
    return {
        {"job_id",   j.id},
        {"status",   j.status},
        {"step",     j.step},
        {"pct",      j.pct},
        {"output",   j.output},
        {"error",    j.error},
        {"log_path", j.log_path},
    };
}

}  // namespace proxy_convert_jobs
