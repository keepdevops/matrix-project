#pragma once

#include "json.hpp"

#include <sys/types.h>
#include <map>
#include <mutex>
#include <string>

struct ConvertJob {
    std::string id;
    std::string status;
    std::string step;
    int         pct   = 0;
    std::string output;
    std::string error;
    std::string log_path;
    pid_t       pid   = -1;
};

namespace proxy_convert_jobs {

std::mutex& jobs_mutex();
std::map<std::string, ConvertJob>& jobs();

std::string make_job_id();
void load_jobs();
void save_jobs();
bool refresh_job(ConvertJob& j);
nlohmann::json job_to_json(ConvertJob& j);

}  // namespace proxy_convert_jobs
