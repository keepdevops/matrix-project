#include "proxy_routes.h"
#include "proxy_routes_system.h"
#include "proxy_configure.h"
#include "proxy_configure_health.h"
#include "proxy_file_io.h"
#include "proxy_models_scan.h"
#include "proxy_routes_convert.h"
#include "proxy_routes_orchestrate.h"
#include "matrix_env.h"
#include "host_memory.h"

#include "httplib.h"
#include "json.hpp"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <unistd.h>

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

    register_proxy_orchestrate_routes(svr);
    register_convert_routes(svr, proj_root);
    register_proxy_system_routes(svr, proj_root);
}
