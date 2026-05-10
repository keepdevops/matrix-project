// Standalone HTTP service that owns a swarm-config.json file (tier E).
// GET/PUT full document with shallow validation (no coordinator mode registry).

#include "httplib.h"
#include "json.hpp"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>

using json = nlohmann::json;

static std::mutex g_mu;
static std::string g_config_path;

static bool read_doc(json& doc) {
    std::ifstream in(g_config_path);
    if (!in.is_open()) return false;
    try {
        doc = json::parse(in);
    } catch (...) {
        return false;
    }
    return true;
}

static bool atomic_write_doc(const json& doc) {
    const std::string tmp = g_config_path + ".tmp";
    {
        std::ofstream out(tmp);
        if (!out.is_open()) return false;
        out << doc.dump(2);
    }
    if (std::rename(tmp.c_str(), g_config_path.c_str()) != 0) return false;
    return true;
}

/// Minimal structural checks so bad PUTs do not corrupt disk.
static bool validate_put_document(const json& doc) {
    if (!doc.is_object()) return false;
    if (!doc.contains("agents") || !doc["agents"].is_array()) return false;
    for (const auto& a : doc["agents"]) {
        if (!a.is_object()) return false;
        if (!a.contains("name") || !a["name"].is_string()) return false;
    }
    if (doc.contains("coordinator")) {
        if (!doc["coordinator"].is_object()) return false;
    }
    return true;
}

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
        if (!read_doc(doc)) {
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
        if (!validate_put_document(doc)) {
            res.status = 400;
            res.set_content(R"({"error":"validation failed: require agents[] with name strings"})",
                            "application/json");
            return;
        }
        std::lock_guard<std::mutex> lk(g_mu);
        if (!atomic_write_doc(doc)) {
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
