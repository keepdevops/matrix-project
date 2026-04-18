#include "httplib.h"
#include "json.hpp"
#include "proxy_configure.h"
#include "matrix_env.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <set>
#include <algorithm>
#include <cctype>
#include <dirent.h>
#include <sys/stat.h>
#include <unistd.h>

using json = nlohmann::json;

// ── file utilities ────────────────────────────────────────────────────────────

static std::string read_file(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) throw std::runtime_error("Cannot read: " + path);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}

static json tail_json(const std::string& path, int n) {
    json lines = json::array();
    std::ifstream f(path);
    if (!f.is_open()) { lines.push_back("(file not found: " + path + ")"); return lines; }
    std::vector<std::string> all;
    for (std::string l; std::getline(f, l);) if (!l.empty()) all.push_back(l);
    int start = (int)all.size() > n ? (int)all.size() - n : 0;
    for (int i = start; i < (int)all.size(); ++i) lines.push_back(all[i]);
    return lines;
}

// ── model scanner ─────────────────────────────────────────────────────────────

static bool is_gguf_name(const std::string& n) {
    return n.size() > 5 && n.compare(n.size() - 5, 5, ".gguf") == 0;
}

// Scan a directory for .gguf files and MLX model dirs (dirs with config.json).
// Recurses into plain subdirectories up to max_depth levels.
static void scan_dir(const std::string& dir, json& result, int max_depth = 1) {
    DIR* d = opendir(dir.c_str());
    if (!d) return;
    std::vector<std::string> entries;
    for (struct dirent* e; (e = readdir(d)) != nullptr;) {
        std::string n = e->d_name;
        if (n != "." && n != "..") entries.push_back(n);
    }
    closedir(d);
    std::sort(entries.begin(), entries.end());
    for (const auto& name : entries) {
        std::string p = dir + "/" + name;
        if (is_gguf_name(name)) {
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                result.push_back({{"name", name}, {"path", p}, {"backend", "mlx"}});
                result.push_back({{"name", name}, {"path", p}, {"backend", "vllm"}});
            } else if (max_depth > 0) {
                scan_dir(p, result, max_depth - 1);
            }
        }
    }
}

// Append Docker Model Runner models via `docker model ls`
static void scan_docker_models(json& result) {
    FILE* fp = popen("docker model ls --format '{{.Name}}' 2>/dev/null", "r");
    if (!fp) return;
    char buf[512];
    while (fgets(buf, sizeof(buf), fp)) {
        std::string name = buf;
        while (!name.empty() && (name.back() == '\n' || name.back() == '\r' || name.back() == ' '))
            name.pop_back();
        if (name.empty() || name == "NAME") continue;
        result.push_back({{"name", name}, {"path", name}, {"backend", "docker"}});
    }
    pclose(fp);
}

static json scan_models() {
    json result = json::array();
    DIR* d = opendir(g_env.model_dir.c_str());
    if (!d) return result;
    std::vector<std::string> entries;
    for (struct dirent* e; (e = readdir(d)) != nullptr;) {
        std::string n = e->d_name;
        if (n != "." && n != "..") entries.push_back(n);
    }
    closedir(d);
    std::sort(entries.begin(), entries.end());
    for (const auto& name : entries) {
        std::string p = g_env.model_dir + "/" + name;
        if (is_gguf_name(name)) {
            result.push_back({{"name", name.substr(0, name.size()-5)},
                              {"path", p}, {"backend", "llama"}});
        } else {
            struct stat st{};
            if (stat(p.c_str(), &st) != 0 || !S_ISDIR(st.st_mode)) continue;
            if (access((p + "/config.json").c_str(), F_OK) == 0) {
                // MLX model directory
                result.push_back({{"name", name}, {"path", p}, {"backend", "mlx"}});
                result.push_back({{"name", name}, {"path", p}, {"backend", "vllm"}});
            } else {
                // Plain subdirectory — scan one level deeper for models
                scan_dir(p, result);
            }
        }
    }
    return result;
}

// ── main ──────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    // Derive project root from the binary's own path
    std::string proj_root = argv[0];
    if (auto sl = proj_root.rfind('/'); sl != std::string::npos)
        proj_root = proj_root.substr(0, sl);
    else proj_root = ".";

    matrix_env_init(proj_root);

    httplib::Server svr;
    svr.set_read_timeout(660, 0);   // vllm/start can block up to 600s
    svr.set_write_timeout(660, 0);

    auto cors = [](httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
    };

    // OPTIONS preflight
    svr.Options(R"(/.*)", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    // GET /api/models — local files + Docker Model Runner models
    svr.Get("/api/models", [&cors](const httplib::Request&, httplib::Response& res) {
        cors(res);
        try {
            json models = scan_models();
            scan_docker_models(models);
            res.set_content(models.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // GET /api/swarm-config
    svr.Get("/api/swarm-config", [&](const httplib::Request&, httplib::Response& res) {
        cors(res);
        try { res.set_content(read_file(proj_root + "/swarm-config.json"), "application/json"); }
        catch (const std::exception& e) {
            res.status = 500;
            res.set_content(json{{"error", e.what()}}.dump(), "application/json");
        }
    });

    // POST /api/configure — blocks until all servers are healthy (up to 245 s)
    svr.Post("/api/configure", [&](const httplib::Request& req, httplib::Response& res) {
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

    // GET /api/logs?ports=8080,8081
    svr.Get("/api/logs", [&](const httplib::Request& req, httplib::Response& res) {
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
            logs.push_back({{"port", std::stoi(tok)}, {"lines", tail_json(lp, 80)}});
        }
        res.set_content(json{{"logs", logs}}.dump(), "application/json");
    });

    // GET /api/swarm/status — lightweight coordinator liveness + agent count
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

    // POST /api/inference/vllm/start — launch vllm servers via start_vllm_servers.sh --wait
    svr.Post("/api/inference/vllm/start", [&](const httplib::Request&, httplib::Response& res) {
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

    // POST /api/clear-cache — clear KV cache on llama + restart MLX servers
    svr.Post("/api/clear-cache", [&](const httplib::Request& req, httplib::Response& res) {
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

    // Catch-all: forward to coordinator on :8000
    auto fwd = [&cors](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        httplib::Client coord("127.0.0.1", g_env.coordinator_port);
        coord.set_connection_timeout(5);
        coord.set_read_timeout(300);
        httplib::Result r;
        if (req.method == "POST") {
            std::string ct = req.get_header_value("Content-Type");
            r = coord.Post(req.path.c_str(), req.body,
                           ct.empty() ? "application/json" : ct.c_str());
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
    svr.Get(R"(.*)", fwd);
    svr.Post(R"(.*)", fwd);

    std::cout << "Matrix Proxy active on http://0.0.0.0:" << g_env.proxy_port << "\n";
    std::cout << "  MATRIX_MODEL_DIR=" << g_env.model_dir << "\n";
    std::cout << "  MATRIX_LLAMA_SERVER=" << g_env.llama_server_bin << "\n";
    svr.listen("0.0.0.0", g_env.proxy_port);
    return 0;
}
