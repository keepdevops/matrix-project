#include "proxy_routes_convert_jobs.h"
#include "proxy_routes_convert_jobs_io.h"
#include "json.hpp"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <random>
#include <sys/wait.h>

std::mutex                        convert_jobs_mu;
std::map<std::string, ConvertJob> convert_jobs;

std::string convert_make_job_id() {
    auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    std::mt19937_64 rng(now);
    char buf[32];
    snprintf(buf, sizeof(buf), "cvt_%llx", (unsigned long long)rng());
    return buf;
}

void convert_save_jobs() {
    convert_io::save_jobs(convert_jobs);
}

void convert_load_jobs() {
    convert_io::load_jobs(convert_jobs, convert_jobs_mu);
}

// Read last non-empty JSON line from the log file and update job state.
// Caller must hold convert_jobs_mu. Returns true if status changed.
bool convert_refresh_job(ConvertJob& j) {
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

// Caller must hold convert_jobs_mu.
nlohmann::json convert_job_to_json(ConvertJob& j) {
    if (convert_refresh_job(j)) convert_save_jobs();
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
