#include "proxy_configure.h"
#include "proxy_configure_internal.h"
#include "proxy_configure_health.h"
#include "proxy_configure_kill_prepare.h"
#include "proxy_configure_coordinator_startup.h"
#include "proxy_validate.h"
#include "matrix_env.h"
#include "config/path_expand.h"
#include <algorithm>
#include <iostream>
#include <fstream>
#include <map>
#include <set>
#include <cstdlib>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

static bool is_port_available(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return false;
    int opt = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    struct sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<uint16_t>(port));
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    bool ok = bind(fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr)) == 0;
    close(fd);
    return ok;
}

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
        // Hard barrier: agents owned by the Python MLX coordinator are invisible here.
        if (a.value("coordinator", "") == "mlx") continue;

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
        // Resolve preferred port: use fixed_port only if it is actually free.
        // If the preferred port is already taken by the OS, fall back to auto-assign
        // so the server can still start on the next available port.
        auto pick_port = [&](int preferred) -> int {
            if (preferred > 0 && is_port_available(preferred) && !fixed_ports.count(preferred))
                return preferred;
            while (fixed_ports.count(next_port) || !is_port_available(next_port)) ++next_port;
            return next_port++;
        };
        if (bk == "docker") key = "docker:shared";
        else if (bk == "docker-vllm" && fixed_port > 0) key = "docker-vllm:" + std::to_string(fixed_port);
        else if ((bk == "mlx" || bk == "vllm") && fixed_port > 0) key = bk + ":" + std::to_string(fixed_port);
        else key = bk + ":" + model + ":" + sg;
        if (!key_to_port.count(key)) {
            if (bk == "docker") key_to_port[key] = PROXY_CONFIGURE_DOCKER_PORT;
            else if (bk == "docker-vllm" || bk == "mlx" || bk == "vllm")
                key_to_port[key] = pick_port(fixed_port);
            else {
                while (fixed_ports.count(next_port) || !is_port_available(next_port)) ++next_port;
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
        // flash_attn: any agent in the group requesting it enables it for all.
        if (a.value("flash_attn", false)) g.flash_attn = true;
        // extra_args: any agent can append verbatim flags; first one wins per unique flag.
        if (a.contains("extra_args") && a["extra_args"].is_array()) {
            for (const auto& arg : a["extra_args"]) {
                if (arg.is_string()) {
                    const std::string s = arg.get<std::string>();
                    if (std::find(g.extra_args.begin(), g.extra_args.end(), s) == g.extra_args.end())
                        g.extra_args.push_back(s);
                }
            }
        }
        // ctx_cap: lowest explicit cap across agents wins (conservative).
        if (a.contains("ctx_cap") && a["ctx_cap"].is_number_integer()) {
            int agent_cap = a["ctx_cap"].get<int>();
            if (agent_cap > 0) g.ctx_cap = std::min(g.ctx_cap, agent_cap);
        }
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
        // Stamp max_concurrency on every llama agent to match its port's slot
        // count. The coordinator semaphore then queues overflow requests in
        // memory rather than letting them race past llama-server's fixed
        // --parallel limit and time out. mlx stays at 1 (already serialised).
        std::map<int, int> port_slots;
        for (const auto& kv2 : pgs)
            if (kv2.second.backend == "llama")
                port_slots[kv2.first] = (int)kv2.second.names.size();
        for (size_t ai = 0; ai < agents.size(); ++ai) {
            auto& a = agents[ai];
            if (!a.is_object()) continue;
            // Match the backend resolution used in the PortGroup build loop.
            std::string bk;
            if (a.contains("backend") && a["backend"].is_string() && !a["backend"].get<std::string>().empty())
                bk = a["backend"].get<std::string>();
            else if (a.contains("engine") && a["engine"].is_string())
                bk = a["engine"].get<std::string>();
            else
                bk = "llama";
            if (bk != "llama") continue;
            int p = a.contains("port") && a["port"].is_number_integer() ? a["port"].get<int>() : -1;
            auto it = port_slots.find(p);
            if (it == port_slots.end()) continue;
            int cur = a.contains("max_concurrency") && a["max_concurrency"].is_number_integer()
                      ? a["max_concurrency"].get<int>() : 0;
            if (cur == 0) a["max_concurrency"] = it->second;
        }
        json active = {{"agents", agents}, {"coordinator", sc["coordinator"]}, {"ui", sc["ui"]}};
        if (sc.contains("rag")) active["rag"] = sc["rag"];
        sc_out << active.dump(2);
    } catch (const std::exception& e) {
        return {false, 500, {{"error", std::string(e.what())}}};
    }

    g_configure_progress.reset(pgs);

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
            g_configure_progress.active.store(false);
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
        g_configure_progress.active.store(false);
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
    g_configure_progress.active.store(false);
    return {true, 200, {{"status","ok"},{"servers",servers}}};
}
