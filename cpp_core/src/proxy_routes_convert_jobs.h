#pragma once
#include "json.hpp"
#include <map>
#include <mutex>
#include <string>
#include <sys/types.h>

using json = nlohmann::json;

struct ConvertJob {
    std::string id;
    std::string status;   // "running" | "done" | "error"
    std::string step;
    int         pct   = 0;
    std::string output;
    std::string error;
    std::string log_path;
    pid_t       pid   = -1;
};

extern std::mutex                         convert_jobs_mu;
extern std::map<std::string, ConvertJob>  convert_jobs;

std::string convert_make_job_id();
void        convert_save_jobs();   // caller must hold convert_jobs_mu
void        convert_load_jobs();
bool        convert_refresh_job(ConvertJob& j);  // caller must hold convert_jobs_mu
json        convert_job_to_json(ConvertJob& j);  // caller must hold convert_jobs_mu
