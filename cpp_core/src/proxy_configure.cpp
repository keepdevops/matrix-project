#include "proxy_configure.h"
#include "proxy_configure_internal.h"
#include "proxy_configure_health.h"
#include "proxy_configure_kill_prepare.h"
#include "proxy_configure_coordinator_startup.h"
#include "proxy_validate.h"
#include "matrix_env.h"
#include "config/path_expand.h"
#include <iostream>
#include <fstream>
#include <map>
#include <set>
#include <cstdlib>

static std::string join(const std::vector<std::string>& v) {
    std::string r;
    for (size_t i = 0; i < v.size(); ++i) { if (i) r += ", "; r += v[i]; }
    return r;
}

static bool ends_with_gguf(const std::string& s) {
    return s.size() > 5 && s.compare(s.size() - 5, 5, ".gguf") == 0;
}

ConfigureResult handle_configure(const json& request_body, const std::string& proj) {
    if (!request_body.contains("agents") || !request_body["agents"].is_array()
        || request_body["agents"].empty())
        return {false, 400, {{"error", "agents array required"}}};

    json agents = request_body["agents"];

    std::map<std::string, int> key_to_port;
    int next_port = 8080;
    std::map<int, PortGroup> pgs;
    std::set<int> fixed_ports;
    for (const auto& a : agents) {
        if (a.contains("port") && a["port"].is_number_integer()) {
            int p = a["port"].get<int>();
            if (p > 0) fixed_ports.insert(p);
        }
    }

    for (auto& a : agents) {
        if (a.contains("model") && a["model"].is_string())
            a["model"] = coordinator_config::expand_model_path(a["model"].get<std::string>());
        if (a.contains("draft_model") && a["draft_model"].is_string())
            a["draft_model"] = coordinator_config::expand_model_path(a["draft_model"].get<std::string>());
    }

    for (auto& a : agents) {
        std::string model = a["model"].get<std::string>();
        std::string sg    = a.value("server_group", "");
        // backend resolution order: explicit "backend" field → "engine" field → infer from extension
        std::string bk = a.contains("backend") && !a["backend"].get<std::string>().empty()
                         ? a["backend"].get<std::string>()
                         : a.contains("engine") && !a["engine"].get<std::string>().empty()
                           ? a["engine"].get<std::string>()
                           : std::string(ends_with_gguf(model) ? "llama" : "mlx");
        std::string key;
        int fixed_port = a.contains("port") ? a["port"].get<int>() : -1;
        if (bk == "docker") key = "docker:shared";
        else if (bk == "docker-vllm" && fixed_port > 0) key = "docker-vllm:" + std::to_string(fixed_port);
        else if ((bk == "mlx" || bk == "vllm") && fixed_port > 0) key = bk + ":" + std::to_string(fixed_port);
        else key = bk + ":" + model + ":" + sg;
        if (!key_to_port.count(key)) {
            if (bk == "docker") key_to_port[key] = PROXY_CONFIGURE_DOCKER_PORT;
            else if ((bk == "docker-vllm" || bk == "mlx" || bk == "vllm") && fixed_port > 0) key_to_port[key] = fixed_port;
            else {
                while (fixed_ports.count(next_port)) ++next_port;
                key_to_port[key] = next_port++;
            }
        }
        int port = key_to_port[key];
        a["port"] = port;
        auto& g = pgs[port];
        float gmu = a.value("gpu_mem_util", 0.75f);
        int default_gpu_layers = (bk == "llama") ? 99 : 0;
        int agent_n_batch = a.value("n_batch", 0);
        if (g.model.empty()) {
            g = {model, bk, a["context"].get<int>(), a.value("gpu_layers", default_gpu_layers), 0, gmu, {}, "", 0};
            g.n_batch = agent_n_batch;
        } else {
            if (g.backend != bk || g.model != model) {
                return {false, 400, {
                    {"error", "Port " + std::to_string(port)
                        + " is assigned to incompatible servers. Put agents that use different backends or models on different ports."},
                    {"port", port},
                    {"existing_backend", g.backend}, {"existing_model", g.model},
                    {"agent", a["name"].get<std::string>()},
                    {"agent_backend", bk}, {"agent_model", model}
                }};
            }
            g.context = std::max(g.context, a["context"].get<int>());
            if (agent_n_batch > 0)
                g.n_batch = (g.n_batch == 0) ? agent_n_batch : std::min(g.n_batch, agent_n_batch);
        }
        g.names.push_back(a["name"].get<std::string>());
        if (bk == "llama") {
            std::string dm = a.value("draft_model", std::string(""));
            int dmax = a.value("draft_max", 0);
            if (!dm.empty()) {
                if (g.draft_model.empty()) {
                    g.draft_model = dm;
                    g.draft_max = dmax;
                } else if (g.draft_model != dm) {
                    std::cerr << "[Configure] WARNING: agent '"
                              << a["name"].get<std::string>()
                              << "' on port " << port << " requested draft_model='"
                              << dm << "' but port already uses '"
                              << g.draft_model << "'; ignoring." << std::endl;
                }
            }
        }
    }

    try {
        json sc;
        const std::string preferred = proj + "/config/coordinator.json";
        const std::string legacy    = proj + "/swarm-config.json";
        std::ifstream sc_in(preferred);
        if (!sc_in.is_open()) {
            sc_in.open(legacy);
            if (!sc_in.is_open())
                throw std::runtime_error("Cannot open " + preferred + " or " + legacy);
        }
        sc = json::parse(sc_in);
        std::ofstream sc_out(g_env.active_config_path);
        if (!sc_out.is_open()) throw std::runtime_error("Cannot write " + g_env.active_config_path);
        json active = {{"agents", agents}, {"coordinator", sc["coordinator"]}, {"ui", sc["ui"]}};
        if (sc.contains("rag")) active["rag"] = sc["rag"];
        sc_out << active.dump(2);
    } catch (const std::exception& e) {
        return {false, 500, {{"error", std::string(e.what())}}};
    }

    proxy_configure_kill_old_and_prepare_dirs(proj);

    for (const auto& [port, g] : pgs) {
        std::string err;
        if (g.backend == "llama")       err = validate_llama_model(g.model);
        else if (g.backend == "mlx")    err = validate_mlx_model(g.model, g_env.mlx_python);
        else if (g.backend == "vllm")   err = validate_vllm_model(g.model, g_env.vllm_python, g.context);
        else if (g.backend == "docker-vllm") err = validate_docker_vllm_model(g.model);
        else if (g.backend == "docker") err = proxy_configure_check_docker_model_runner(g.model);
        if (!err.empty()) {
            std::cerr << "[Configure] Pre-flight failed port " << port << ": " << err << "\n";
            return {false, 400, {{"error", err}, {"port", port}, {"model", g.model}}};
        }
    }

    spawn_inference_servers(pgs, proj);

    int health_timeout = 240;
    for (const auto& kv : pgs) {
        if (kv.second.backend == "docker-vllm") { health_timeout = 600; break; }
    }
    auto failed = proxy_configure_wait_for_health(pgs, health_timeout);
    if (!failed.empty()) {
        json fa = json::array();
        std::string fl;
        for (int p : failed) { fa.push_back(p); if (!fl.empty()) fl += ", "; fl += std::to_string(p); }
        std::cerr << "[Configure] Health timeout. Ports not ready: " << fl << "\n";
        return {false, 503, {
            {"error", "Servers failed to become healthy within several minutes. Check agent_logs/"
                      + std::to_string(failed[0]) + ".log. Ports not ready: " + fl
                      + ". MLX can take 1-2 min per model on first load."},
            {"failedPorts", fa}
        }};
    }

    proxy_configure_spawn_coordinator(proj);

    json servers = json::array();
    for (const auto& [port, g] : pgs) {
        std::string mn = g.model;
        if (auto sl = mn.rfind('/'); sl != std::string::npos) mn = mn.substr(sl + 1);
        if (ends_with_gguf(mn)) mn = mn.substr(0, mn.size() - 5);
        json na = json::array(); for (auto& n : g.names) na.push_back(n);
        servers.push_back({{"port",port},{"model",mn},{"agents",na},{"parallel",(int)g.names.size()}});
    }
    std::cout << "[Configure] Swarm online: " << servers.size() << " server(s)\n";
    return {true, 200, {{"status","ok"},{"servers",servers}}};
}
