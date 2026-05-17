#include "proxy_routes_convert.h"
#include "matrix_env.h"
#include "json.hpp"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <map>
#include <mutex>
#include <random>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

using json = nlohmann::json;

namespace {

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

std::mutex             jobs_mu;
std::map<std::string, ConvertJob> jobs;

std::string make_job_id() {
    auto now = std::chrono::steady_clock::now().time_since_epoch().count();
    std::mt19937_64 rng(now);
    char buf[32];
    snprintf(buf, sizeof(buf), "cvt_%llx", (unsigned long long)rng());
    return buf;
}

// Read last non-empty JSON line from the log file and update job state.
void refresh_job(ConvertJob& j) {
    if (j.status == "done" || j.status == "error") return;

    // Read the log first — if it already says done/error, trust that.
    std::ifstream f(j.log_path);
    if (f.is_open()) {
        std::string last, line;
        while (std::getline(f, line))
            if (!line.empty()) last = line;
        if (!last.empty()) {
            try {
                auto parsed = json::parse(last);
                j.status = parsed.value("status", j.status);
                j.step   = parsed.value("step",   j.step);
                j.pct    = parsed.value("pct",    j.pct);
                j.output = parsed.value("output", j.output);
                if (parsed.contains("error")) j.error = parsed["error"].get<std::string>();
            } catch (...) {}
        }
    }

    // If still running, check whether the process exited without writing a terminal line.
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
}

json job_to_json(ConvertJob& j) {
    refresh_job(j);
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

} // namespace

void register_convert_routes(httplib::Server& svr, const std::string& proj_root) {
    auto cors = [](httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
    };

    // POST /api/models/convert — start a conversion job
    svr.Post("/api/models/convert", [&cors, proj_root](
            const httplib::Request& req, httplib::Response& res) {
        cors(res);
        json body;
        try { body = json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content(json{{"error","invalid JSON"}}.dump(), "application/json");
            return;
        }
        if (!body.contains("hf_repo") || !body["hf_repo"].is_string()
            || body["hf_repo"].get<std::string>().empty()) {
            res.status = 400;
            res.set_content(json{{"error","hf_repo required"}}.dump(), "application/json");
            return;
        }
        if (!body.contains("output_name") || !body["output_name"].is_string()
            || body["output_name"].get<std::string>().empty()) {
            res.status = 400;
            res.set_content(json{{"error","output_name required"}}.dump(), "application/json");
            return;
        }

        std::string hf_repo     = body["hf_repo"].get<std::string>();
        std::string output_name = body["output_name"].get<std::string>();
        int         q_bits      = body.value("q_bits", 4);
        std::string hf_token    = body.value("hf_token", std::string(""));
        if (q_bits != 4 && q_bits != 8) q_bits = 4;

        std::string mlx_dir = g_env.model_dir + "/mlx/MLX/" + output_name;
        std::string job_id  = make_job_id();
        std::string log     = "/tmp/matrix-convert-" + job_id + ".log";

        // Build command: redirect stdout+stderr to log file.
        // Pass HF_TOKEN via --hf-token arg (not env) so it doesn't linger in
        // the process environment after the script exits.
        std::string cmd = g_env.mlx_python
            + " " + proj_root + "/scripts/gguf_to_mlx.py"
            + " --hf-repo \"" + hf_repo + "\""
            + " --output \"" + mlx_dir + "\""
            + " --q-bits " + std::to_string(q_bits)
            + (hf_token.empty() ? "" : " --hf-token \"" + hf_token + "\"")
            + " >> \"" + log + "\" 2>&1";

        pid_t pid = fork();
        if (pid == 0) {
            // Child: run in new session so it outlives the request thread.
            setsid();
            execl("/bin/sh", "sh", "-c", cmd.c_str(), nullptr);
            _exit(1);
        }
        if (pid < 0) {
            res.status = 500;
            res.set_content(json{{"error","fork failed"}}.dump(), "application/json");
            return;
        }

        {
            std::lock_guard<std::mutex> lk(jobs_mu);
            jobs[job_id] = {job_id, "running", "starting", 0, "", "", log, pid};
        }
        res.set_content(json{{"job_id", job_id}, {"log", log}}.dump(), "application/json");
    });

    // GET /api/models/convert/:id — poll job status
    svr.Get(R"(/api/models/convert/([^/]+))", [&cors](
            const httplib::Request& req, httplib::Response& res) {
        cors(res);
        std::string id = req.matches[1];
        std::lock_guard<std::mutex> lk(jobs_mu);
        auto it = jobs.find(id);
        if (it == jobs.end()) {
            res.status = 404;
            res.set_content(json{{"error","job not found"}}.dump(), "application/json");
            return;
        }
        res.set_content(job_to_json(it->second).dump(), "application/json");
    });

    // GET /api/models/convert — list all jobs
    svr.Get("/api/models/convert", [&cors](
            const httplib::Request&, httplib::Response& res) {
        cors(res);
        json arr = json::array();
        std::lock_guard<std::mutex> lk(jobs_mu);
        for (auto& [id, j] : jobs) arr.push_back(job_to_json(const_cast<ConvertJob&>(j)));
        res.set_content(arr.dump(), "application/json");
    });
}
