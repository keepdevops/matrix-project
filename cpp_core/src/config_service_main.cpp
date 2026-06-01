// Standalone HTTP service that owns a swarm-config.json file (tier E).
// GET/PUT full document with shallow validation (no coordinator mode registry).

#include "httplib.h"
#include "json.hpp"
#include "config_service_handlers.h"

#include <cstdlib>
#include <iostream>
#include <mutex>
#include <string>

using json = nlohmann::json;

static std::mutex g_mu;
static std::string g_config_path;

int main(int argc, char* argv[]) {
    int port = 8011;
    if (const char* pe = std::getenv("MATRIX_CONFIG_SERVICE_PORT")) {
        try {
            port = std::stoi(pe);
        } catch (...) {}
    }

    for (int i = 1; i < argc; ++i) {
        if (std::string(argv[i]) == "--config" && i + 1 < argc) {
            g_config_path = argv[++i];
            continue;
        }
        if (std::string(argv[i]) == "--port" && i + 1 < argc) {
            try {
                port = std::stoi(argv[++i]);
            } catch (...) {}
            continue;
        }
    }

    if (g_config_path.empty()) {
        std::cerr << "usage: matrix_config_service --config /path/to/swarm-config.json [--port N]\n"
                     "env: MATRIX_CONFIG_SERVICE_PORT\n";
        return 1;
    }

    httplib::Server svr;

    svr.Get("/health", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(R"({"status":"ok"})", "application/json");
    });

    svr.Get("/api/v1/config", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(g_mu);
        json doc;
        if (!config_svc::read_doc(g_config_path, doc)) {
            res.status = 404;
            res.set_content(R"({"error":"cannot read config file"})", "application/json");
            return;
        }
        res.set_content(doc.dump(), "application/json");
    });

    svr.Put("/api/v1/config", [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        json doc;
        try {
            doc = json::parse(req.body);
        } catch (...) {
            res.status = 400;
            res.set_content(R"({"error":"invalid JSON"})", "application/json");
            return;
        }
        if (!config_svc::validate_put_body(doc)) {
            res.status = 400;
            res.set_content(R"({"error":"validation failed: require agents[] with name strings"})",
                            "application/json");
            return;
        }
        std::lock_guard<std::mutex> lk(g_mu);
        if (!config_svc::atomic_write_doc(g_config_path, doc)) {
            res.status = 500;
            res.set_content(R"({"error":"write failed"})", "application/json");
            return;
        }
        res.set_content(R"({"ok":true})", "application/json");
    });

    std::cout << "matrix_config_service listening on 0.0.0.0:" << port
              << "  config=" << g_config_path << std::endl;
    if (!svr.listen("0.0.0.0", port)) {
        std::cerr << "❌ listen failed\n";
        return 1;
    }
    return 0;
}
