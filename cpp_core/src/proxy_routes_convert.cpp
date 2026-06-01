#include "proxy_routes_convert.h"
#include "proxy_routes_convert_jobs.h"
#include "matrix_env.h"

#include <string>
#include <sys/wait.h>
#include <unistd.h>

void register_convert_routes(httplib::Server& svr, const std::string& proj_root) {
    convert_load_jobs();
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
        std::string job_id  = convert_make_job_id();
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
            std::lock_guard<std::mutex> lk(convert_jobs_mu);
            convert_jobs[job_id] = {job_id, "running", "starting", 0, "", "", log, pid};
            convert_save_jobs();
        }
        res.set_content(json{{"job_id", job_id}, {"log", log}}.dump(), "application/json");
    });

    // GET /api/models/convert/:id — poll job status
    svr.Get(R"(/api/models/convert/([^/]+))", [&cors](
            const httplib::Request& req, httplib::Response& res) {
        cors(res);
        std::string id = req.matches[1];
        std::lock_guard<std::mutex> lk(convert_jobs_mu);
        auto it = convert_jobs.find(id);
        if (it == convert_jobs.end()) {
            res.status = 404;
            res.set_content(json{{"error","job not found"}}.dump(), "application/json");
            return;
        }
        res.set_content(convert_job_to_json(it->second).dump(), "application/json");
    });

    // GET /api/models/convert — list all jobs
    svr.Get("/api/models/convert", [&cors](
            const httplib::Request&, httplib::Response& res) {
        cors(res);
        json arr = json::array();
        std::lock_guard<std::mutex> lk(convert_jobs_mu);
        for (auto& [id, j] : convert_jobs) arr.push_back(convert_job_to_json(j));
        res.set_content(arr.dump(), "application/json");
    });
}
