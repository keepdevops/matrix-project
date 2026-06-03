#include "proxy_routes_system.h"
#include "matrix_env.h"
#include "json.hpp"
#include "httplib.h"

#include <iostream>
#include <string>

using json = nlohmann::json;

void register_proxy_system_routes(httplib::Server& svr, const std::string& proj_root) {
    auto cors = [](httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
    };

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

    svr.Post("/api/inference/vllm/start", [&cors, proj_root](const httplib::Request&, httplib::Response& res) {
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

            result["llama"] = (r && r->status == 200)
                ? json::parse(r->body)
                : json("coordinator offline");

            res.set_content(result.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // Catch-all forward to coordinator
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
            // Forward coordinator headers. Skip httplib-managed headers and CORS
            // headers the proxy already sets (avoid duplicate Access-Control-* values
            // which browsers reject).
            static const std::vector<std::string> SKIP_HEADERS = {
                "content-length", "transfer-encoding", "connection",
                "access-control-allow-origin", "access-control-allow-methods",
                "access-control-allow-headers"
            };
            for (const auto& [k, v] : r->headers) {
                std::string lk = k;
                for (auto& c : lk) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                bool skip = false;
                for (const auto& s : SKIP_HEADERS) { if (lk == s) { skip = true; break; } }
                if (!skip) res.set_header(k.c_str(), v.c_str());
            }
            std::string ct = r->get_header_value("Content-Type");
            res.set_content(r->body, ct.empty() ? "application/json" : ct.c_str());
        } else {
            res.status = 503;
            res.set_content(
                "{\"error\":\"Coordinator offline. Deploy a swarm configuration first.\"}",
                "application/json");
        }
    };
    svr.Get   (R"(.*)", fwd);
    svr.Post  (R"(.*)", fwd);
    svr.Put   (R"(.*)", fwd);
    svr.Delete(R"(.*)", fwd);
}
