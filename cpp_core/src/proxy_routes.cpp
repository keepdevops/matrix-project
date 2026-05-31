#include "proxy_routes.h"
#include "proxy_configure.h"
#include "proxy_configure_health.h"
#include "proxy_file_io.h"
#include "proxy_models_scan.h"
#include "proxy_routes_convert.h"
#include "matrix_env.h"
#include "host_memory.h"

#include "httplib.h"
#include "json.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <unistd.h>
#include <set>
#include <sstream>
#include <string>

using json = nlohmann::json;

void register_proxy_routes(httplib::Server& svr, const std::string& proj_root) {
    auto cors = [](httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
    };

    svr.Options(R"(/.*)", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    svr.Get("/api/models", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        try {
            json models = proxy_scan_models_from_env();
            proxy_append_docker_models(models);
            res.set_content(models.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Get("/api/swarm-config", [&cors, &proj_root](const httplib::Request&, httplib::Response& res) {
        cors(res);
        try {
            res.set_content(proxy_read_file_text(proj_root + "/swarm-config.json"), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    svr.Post("/api/configure", [&cors, &proj_root](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        try {
            auto result = handle_configure(json::parse(req.body), proj_root);
            res.status = result.http_status;
            res.set_content(result.body.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "[Configure] Error: " << e.what() << "\n";
            res.status = 500;
            res.set_content(json{{"error", std::string(e.what())}}.dump(), "application/json");
        }
    });

    svr.Get("/api/configure/status", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        res.set_content(g_configure_progress.to_json().dump(), "application/json");
    });

    svr.Get("/api/memory", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        res.set_content(host_memory_snapshot().dump(), "application/json");
    });

    svr.Get("/api/logs", [&cors, &proj_root](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        std::string raw = req.has_param("ports") ? req.get_param_value("ports")
                        : req.has_param("port")  ? req.get_param_value("port") : "";
        if (raw.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"Query param ports required\"}", "application/json");
            return;
        }
        json logs = json::array();
        std::istringstream ss(raw);
        std::string tok;
        std::set<std::string> seen;
        while (std::getline(ss, tok, ',') && logs.size() < 10) {
            while (!tok.empty() && tok.front() == ' ') tok.erase(tok.begin());
            while (!tok.empty() && tok.back()  == ' ') tok.pop_back();
            if (tok.empty() || !std::all_of(tok.begin(), tok.end(), ::isdigit)) continue;
            if (!seen.insert(tok).second) continue;
            std::string lp = proj_root + "/agent_logs/" + tok + ".log";
            if (access(lp.c_str(), F_OK) != 0) lp = proj_root + "/logs/" + tok + ".log";
            logs.push_back({{"port", std::stoi(tok)}, {"lines", proxy_tail_log_lines(lp, 80)}});
        }
        res.set_content(json{{"logs", logs}}.dump(), "application/json");
    });

    svr.Get("/api/swarm/status", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        try {
            httplib::Client coord("127.0.0.1", g_env.coordinator_port);
            coord.set_connection_timeout(2);
            coord.set_read_timeout(5);
            auto health = coord.Get("/api/health");
            if (!health || health->status != 200) {
                res.set_content(json{{"online", false}, {"agents", 0}}.dump(), "application/json");
                return;
            }
            auto agents_r = coord.Get("/api/agents");
            int agent_count = 0;
            if (agents_r && agents_r->status == 200) {
                try { agent_count = (int)json::parse(agents_r->body).size(); } catch (...) {}
            }
            res.set_content(json{{"online", true}, {"agents", agent_count}}.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "[swarm/status] " << e.what() << "\n";
            res.set_content(json{{"online", false}, {"agents", 0}}.dump(), "application/json");
        }
    });

    svr.Post("/api/inference/vllm/start", [&cors, &proj_root](const httplib::Request&, httplib::Response& res) {
        cors(res);
        std::string script = "cd " + proj_root + " && bash scripts/start_vllm_servers.sh --wait >/dev/null 2>&1";
        int rc = system(script.c_str());
        if (rc == 0) {
            res.set_content(json{{"ok", true}, {"ports", {8080,8081,8082,8083}}}.dump(), "application/json");
        } else {
            res.status = 500;
            res.set_content(json{{"ok", false}, {"error", "start_vllm_servers.sh failed"}}.dump(), "application/json");
        }
    });

    svr.Post("/api/clear-cache", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        json result;
        try {
            system("pkill -f 'mlx_lm.server' 2>/dev/null");
            result["mlx_killed"] = "MLX servers restarted to clear state";

            httplib::Client coord("127.0.0.1", g_env.coordinator_port);
            coord.set_connection_timeout(5);
            coord.set_read_timeout(10);
            auto r = coord.Post("/api/clear-cache", "", "application/json");

            if (r && r->status == 200) {
                auto coord_result = json::parse(r->body);
                result["llama"] = coord_result;
            } else {
                result["llama"] = "coordinator offline";
            }

            res.set_content(result.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // Forward Python-backend orchestration modes to the MLX coordinator sidecar.
    // The body must include "mode" (a Python-side mode_id) and "prompt".
    // Returns blocking JSON {result, session_id, mode, meta}; SSE streaming is MS-25-2.
    svr.Post("/api/orchestrate", [&cors](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        try {
            auto body = json::parse(req.body);
            std::string mode = body.value("mode", "");
            if (mode.empty()) {
                res.status = 400;
                res.set_content(json{{"error", "'mode' required"}}.dump(), "application/json");
                return;
            }
            httplib::Client py_coord("127.0.0.1", g_env.python_coord_port);
            py_coord.set_connection_timeout(5);
            py_coord.set_read_timeout(300);
            auto r = py_coord.Post("/api/orchestrate", req.body, "application/json");
            if (r) {
                res.status = r->status;
                std::string ct = r->get_header_value("Content-Type");
                res.set_content(r->body, ct.empty() ? "application/json" : ct.c_str());
            } else {
                res.status = 503;
                res.set_content(
                    json{{"error", "Python coordinator offline — run: brewctl launch"}}.dump(),
                    "application/json");
            }
        } catch (const std::exception& e) {
            std::cerr << "[/api/orchestrate] " << e.what() << "\n";
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    auto fwd = [&cors](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        httplib::Client coord("127.0.0.1", g_env.coordinator_port);
        coord.set_connection_timeout(5);
        coord.set_read_timeout(300);
        httplib::Result r;
        if (req.method == "POST" || req.method == "PUT") {
            std::string ct = req.get_header_value("Content-Type");
            const char* mime = ct.empty() ? "application/json" : ct.c_str();
            r = (req.method == "POST")
                ? coord.Post(req.path.c_str(), req.body, mime)
                : coord.Put (req.path.c_str(), req.body, mime);
        } else if (req.method == "DELETE") {
            r = coord.Delete(req.path.c_str());
        } else {
            r = coord.Get(req.path.c_str());
        }
        if (r) {
            res.status = r->status;
            std::string ct = r->get_header_value("Content-Type");
            res.set_content(r->body, ct.empty() ? "application/json" : ct.c_str());
        } else {
            res.status = 503;
            res.set_content(
                "{\"error\":\"Coordinator offline. Deploy a swarm configuration first.\"}",
                "application/json");
        }
    };
    register_convert_routes(svr, proj_root);

    svr.Get   (R"(.*)", fwd);
    svr.Post  (R"(.*)", fwd);
    svr.Put   (R"(.*)", fwd);
    svr.Delete(R"(.*)", fwd);
}
