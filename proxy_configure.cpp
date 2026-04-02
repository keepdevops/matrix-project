#include "proxy_configure.h"
#include "matrix_env.h"
#include "httplib.h"
#include <iostream>
#include <fstream>
#include <map>
#include <thread>
#include <chrono>
#include <spawn.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <cstring>
#include <cerrno>
#if defined(__APPLE__)
#include <crt_externs.h>
#endif

static char** spawn_environ() {
#if defined(__APPLE__)
    return *_NSGetEnviron();
#else
    extern char** environ;
    return environ;
#endif
}

// ── helpers ──────────────────────────────────────────────────────────────────

static std::string join(const std::vector<std::string>& v) {
    std::string r;
    for (size_t i = 0; i < v.size(); ++i) { if (i) r += ", "; r += v[i]; }
    return r;
}

static bool ends_with_gguf(const std::string& s) {
    return s.size() > 5 && s.compare(s.size() - 5, 5, ".gguf") == 0;
}

// ── spawn_detached ────────────────────────────────────────────────────────────

void spawn_detached(const std::string& bin,
                    const std::vector<std::string>& args,
                    const std::string& log_path,
                    bool use_path_search)
{
    int fd = open(log_path.c_str(), O_WRONLY | O_CREAT | O_APPEND, 0644);
    if (fd < 0) fd = open("/dev/null", O_WRONLY);

    posix_spawn_file_actions_t fa;
    posix_spawn_file_actions_init(&fa);
    posix_spawn_file_actions_addclose(&fa, STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&fa, fd, STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&fa, fd, STDERR_FILENO);

    posix_spawnattr_t attr;
    posix_spawnattr_init(&attr);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSID);

    // Build argv: must outlive posix_spawn call
    std::vector<char*> argv_ptrs;
    argv_ptrs.push_back(const_cast<char*>(bin.c_str()));
    for (const auto& a : args) argv_ptrs.push_back(const_cast<char*>(a.c_str()));
    argv_ptrs.push_back(nullptr);

    pid_t pid = -1;
    int rc = use_path_search
        ? posix_spawnp(&pid, bin.c_str(), &fa, &attr, argv_ptrs.data(), spawn_environ())
        : posix_spawn (&pid, bin.c_str(), &fa, &attr, argv_ptrs.data(), spawn_environ());
    if (rc != 0)
        std::cerr << "[spawn] " << bin << ": " << strerror(rc) << "\n";

    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&attr);
    close(fd);
}

// ── wait_for_health ──────────────────────────────────────────────────────────

struct PortGroup {
    std::string model, backend;
    int context = 0, gpu_layers = 0;
    std::vector<std::string> names;
};

static std::vector<int> wait_for_health(
    const std::map<int, PortGroup>& pgs,
    int timeout_secs)
{
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(timeout_secs);
    auto check = [&]() -> std::vector<int> {
        std::vector<int> failed;
        for (const auto& [port, g] : pgs) {
            const char* path = (g.backend == "mlx") ? "/v1/models" : "/health";
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(30);
                auto r = cli.Get(path);
                if (!r || r->status != 200) failed.push_back(port);
            } catch (...) { failed.push_back(port); }
        }
        return failed;
    };
    while (std::chrono::steady_clock::now() < deadline) {
        if (check().empty()) return {};
        std::this_thread::sleep_for(std::chrono::seconds(2));
    }
    return check();
}

// ── handle_configure ─────────────────────────────────────────────────────────

ConfigureResult handle_configure(const json& request_body, const std::string& proj) {
    if (!request_body.contains("agents") || !request_body["agents"].is_array()
        || request_body["agents"].empty())
        return {false, 400, {{"error", "agents array required"}}};

    json agents = request_body["agents"];
    std::map<std::string, int> key_to_port;
    int next_port = 8080;
    std::map<int, PortGroup> pgs;

    for (auto& a : agents) {
        std::string model = a["model"].get<std::string>();
        std::string sg    = a.value("server_group", "");
        std::string bk    = a.value("backend",
                              std::string(ends_with_gguf(model) ? "llama" : "mlx"));
        std::string key   = bk + ":" + model + ":" + sg;
        if (!key_to_port.count(key)) key_to_port[key] = next_port++;
        int port = key_to_port[key];
        a["port"] = port;
        auto& g = pgs[port];
        if (g.model.empty()) g = {model, bk, a["context"].get<int>(), a["gpu_layers"].get<int>(), {}};
        else g.context = std::max(g.context, a["context"].get<int>());
        g.names.push_back(a["name"].get<std::string>());
    }

    // Write active config
    try {
        std::ifstream sc_in(proj + "/swarm-config.json");
        if (!sc_in.is_open()) throw std::runtime_error("Cannot open swarm-config.json");
        json sc = json::parse(sc_in);
        std::ofstream sc_out(g_env.active_config_path);
        if (!sc_out.is_open()) throw std::runtime_error("Cannot write " + g_env.active_config_path);
        sc_out << json{{"agents", agents}, {"coordinator", sc["coordinator"]}, {"ui", sc["ui"]}}.dump(2);
    } catch (const std::exception& e) {
        return {false, 500, {{"error", std::string(e.what())}}};
    }

    // Kill old processes, free ports
    system("pkill -f llama-server 2>/dev/null");
    system("pkill -f 'llama_cpp.server' 2>/dev/null");
    system("pkill -f 'mlx_lm.server' 2>/dev/null");
    system("pkill -f 'vllm.entrypoints' 2>/dev/null");
    system(("pkill -f '" + proj + "/coordinator' 2>/dev/null").c_str());
    system("lsof -ti:8080,8081,8082,8083,8084,8085,8086 | xargs kill -9 2>/dev/null");
    std::this_thread::sleep_for(std::chrono::seconds(5));
    mkdir(g_env.matrix_slots_dir.c_str(), 0755);
    mkdir((proj + "/logs").c_str(), 0755);
    mkdir((proj + "/agent_logs").c_str(), 0755);

    // Spawn inference servers
    int hf_n = 0;
    for (const auto& [port, g] : pgs) {
        std::string log = proj + "/agent_logs/" + std::to_string(port) + ".log";
        std::string ps  = std::to_string(port);
        if (g.backend == "mlx") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            spawn_detached(g_env.mlx_python,
                {"-m","mlx_lm.server","--model",g.model,"--port",ps,"--host","127.0.0.1"}, log);
            std::cout << "[Configure] MLX :" << port << " [" << join(g.names) << "]\n";
        } else if (g.backend == "vllm") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            spawn_detached("python3",
                {"-m","vllm.entrypoints.openai.api_server","--model",g.model,
                 "--port",ps,"--host","127.0.0.1","--max-model-len",std::to_string(g.context)},
                log, /*use_path_search=*/true);
            std::cout << "[Configure] vLLM :" << port << " [" << join(g.names) << "]\n";
        } else {
            int ctx = std::min(g.context, 8192) * (int)g.names.size();
            spawn_detached(g_env.llama_server_bin,
                {"-m",g.model,"-c",std::to_string(ctx),"--port",ps,
                 "--n-gpu-layers",std::to_string(g.gpu_layers),
                 "--parallel",std::to_string(g.names.size()),
                 "--slot-save-path",g_env.matrix_slots_dir}, log);
            std::cout << "[Configure] LLAMA :" << port << " x" << g.names.size()
                      << " [" << join(g.names) << "]\n";
        }
    }

    // Wait for health (up to 240 s)
    auto failed = wait_for_health(pgs, 240);
    if (!failed.empty()) {
        json fa = json::array();
        std::string fl;
        for (int p : failed) { fa.push_back(p); if (!fl.empty()) fl += ", "; fl += std::to_string(p); }
        std::cerr << "[Configure] Health timeout. Ports not ready: " << fl << "\n";
        return {false, 503, {
            {"error", "Servers failed to become healthy within 4 minutes. Check agent_logs/"
                      + std::to_string(failed[0]) + ".log. Ports not ready: " + fl
                      + ". MLX can take 1-2 min per model on first load."},
            {"failedPorts", fa}
        }};
    }

    // Start coordinator
    spawn_detached(proj + "/coordinator", {"--config", g_env.active_config_path},
                   proj + "/agent_logs/coordinator.log");
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));

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
