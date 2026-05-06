#include "proxy_configure.h"
#include "proxy_validate.h"
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

static const int DOCKER_PORT = 12434;

// ── wait_for_health ──────────────────────────────────────────────────────────

struct PortGroup {
    std::string model, backend;
    int context = 0, gpu_layers = 0;
    float gpu_mem_util = 0.75f;
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
            const char* path = (g.backend == "mlx" || g.backend == "docker"
                            || g.backend == "vllm" || g.backend == "docker-vllm")
                           ? "/v1/models" : "/health";
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

// ── check_docker_model_runner ─────────────────────────────────────────────────

// Pre-flight check for the "docker" backend (Docker Desktop Model Runner).
// Probes port 12434 with a short timeout and verifies the model is already loaded.
// Returns "" on success, error string on failure.
static std::string check_docker_model_runner(const std::string& model) {
    if (model.empty())
        return "docker agent requires a non-empty model field"
               "\n  (e.g. ai/meta-llama-3.2-3b-instruct:Q8_0-F32)";

    httplib::Client cli("127.0.0.1", DOCKER_PORT);
    cli.set_connection_timeout(3);
    cli.set_read_timeout(3);
    auto r = cli.Get("/v1/models");
    if (!r || r->status != 200)
        return "Docker Model Runner is not running on port "
             + std::to_string(DOCKER_PORT)
             + ".\n  Start it with: docker model run " + model
             + "\n  Then relaunch the swarm.";

    // Check if the requested model appears in the loaded model list.
    // Use substring match to handle tag variants (e.g. ":Q8_0-F32" suffixes).
    const std::string& body = r->body;
    if (body.find(model) != std::string::npos) return "";

    // Model not found — collect loaded model IDs for a helpful error.
    std::string loaded;
    try {
        json j = json::parse(body);
        if (j.contains("data") && j["data"].is_array()) {
            for (const auto& m : j["data"]) {
                if (m.contains("id") && m["id"].is_string()) {
                    if (!loaded.empty()) loaded += ", ";
                    loaded += m["id"].get<std::string>();
                }
            }
        }
    } catch (...) {}

    return "Model '" + model + "' is not loaded in Docker Model Runner."
         + "\n  Run: docker model run " + model
         + (loaded.empty() ? "" : "\n  Currently loaded: " + loaded);
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
        // docker-vllm: each model gets a fixed port specified in the agent config.
        // docker (Docker Desktop shared endpoint): all agents share DOCKER_PORT.
        std::string key;
        int fixed_port = a.contains("port") ? a["port"].get<int>() : -1;
        if (bk == "docker") key = "docker:shared";
        else if (bk == "docker-vllm" && fixed_port > 0) key = "docker-vllm:" + std::to_string(fixed_port);
        else if ((bk == "mlx" || bk == "vllm") && fixed_port > 0) key = bk + ":" + std::to_string(fixed_port);
        else key = bk + ":" + model + ":" + sg;
        if (!key_to_port.count(key)) {
            if (bk == "docker") key_to_port[key] = DOCKER_PORT;
            else if ((bk == "docker-vllm" || bk == "mlx" || bk == "vllm") && fixed_port > 0) key_to_port[key] = fixed_port;
            else key_to_port[key] = next_port++;
        }
        int port = key_to_port[key];
        a["port"] = port;
        auto& g = pgs[port];
        float gmu = a.value("gpu_mem_util", 0.75f);
        // Default to 99 (all layers on GPU) for llama backend — CPU-only (0) causes
        // inference to exceed read_timeout on large models like Codestral-22B.
        int default_gpu_layers = (bk == "llama") ? 99 : 0;
        if (g.model.empty()) g = {model, bk, a["context"].get<int>(), a.value("gpu_layers", default_gpu_layers), gmu, {}};
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

    // Kill old processes, free ports (never touch Docker Desktop / port 12434)
    system("pkill -f llama-server 2>/dev/null");
    system("pkill -f 'llama_cpp.server' 2>/dev/null");
    system("pkill -f 'mlx_lm.server' 2>/dev/null");
    system("pkill -f 'vllm.entrypoints' 2>/dev/null");
    system("pkill -f 'docker model run' 2>/dev/null");
    system(("pkill -f '" + proj + "/coordinator' 2>/dev/null").c_str());
    system("lsof -ti:8080,8081,8082,8083,8084,8085,8086,8087,8088,8089,8090 | xargs kill -9 2>/dev/null");
    std::this_thread::sleep_for(std::chrono::seconds(5));
    mkdir(g_env.matrix_slots_dir.c_str(), 0755);
    mkdir((proj + "/logs").c_str(), 0755);
    mkdir((proj + "/agent_logs").c_str(), 0755);

    // Pre-flight: validate all models before killing existing processes
    for (const auto& [port, g] : pgs) {
        std::string err;
        if (g.backend == "llama")
            err = validate_llama_model(g.model);
        else if (g.backend == "mlx")
            err = validate_mlx_model(g.model, g_env.mlx_python);
        else if (g.backend == "vllm")
            err = validate_vllm_model(g.model, g_env.vllm_python, g.context);
        else if (g.backend == "docker-vllm")
            err = validate_docker_vllm_model(g.model);
        else if (g.backend == "docker")
            err = check_docker_model_runner(g.model);
        if (!err.empty()) {
            std::cerr << "[Configure] Pre-flight failed port " << port << ": " << err << "\n";
            return {false, 400, {{"error", err}, {"port", port}, {"model", g.model}}};
        }
    }

    // Spawn inference servers
    int hf_n = 0;
    for (const auto& [port, g] : pgs) {
        std::string log = proj + "/agent_logs/" + std::to_string(port) + ".log";
        std::string ps  = std::to_string(port);
        if (g.backend == "docker") {
            // Docker Model Runner is managed by Docker Desktop — no local spawning.
            // The model must already be loaded via: docker model run <model> --port 12434
            std::cout << "[Configure] DOCKER :" << port << " model=" << g.model
                      << " [" << join(g.names) << "]\n";
        } else if (g.backend == "mlx") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            spawn_detached(g_env.mlx_python,
                {"-m","mlx_lm","server","--model",g.model,"--port",ps,"--host","127.0.0.1"}, log);
            std::cout << "[Configure] MLX :" << port << " [" << join(g.names) << "]\n";
        } else if (g.backend == "vllm") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            char gmu_buf[16];
            snprintf(gmu_buf, sizeof(gmu_buf), "%.2f", g.gpu_mem_util);
            // Use MATRIX_VLLM_PYTHON (conda env) if set; fallback to system python3
            const std::string& vllm_py = g_env.vllm_python;
            spawn_detached(vllm_py,
                {"-m","vllm.entrypoints.openai.api_server","--model",g.model,
                 "--port",ps,"--host","127.0.0.1","--max-model-len",std::to_string(g.context),
                 "--gpu-memory-utilization",std::string(gmu_buf)},
                log, /*use_path_search=*/false);
            std::cout << "[Configure] vLLM :" << port << " gpu_mem=" << gmu_buf
                      << " python=" << vllm_py << " [" << join(g.names) << "]\n";
        } else if (g.backend == "docker-vllm") {
            char gmu_buf[16];
            snprintf(gmu_buf, sizeof(gmu_buf), "%.2f", g.gpu_mem_util);
            spawn_detached("docker",
                {"model","run",g.model,
                 "--backend","vllm",
                 "--port",ps,
                 "--gpu-memory-utilization",std::string(gmu_buf),
                 "--max-model-len",std::to_string(g.context)},
                log, /*use_path_search=*/true);
            std::cout << "[Configure] DOCKER-vLLM :" << port << " gpu_mem=" << gmu_buf
                      << " [" << join(g.names) << "]\n";
        } else {
            int per_agent = std::min(g.context, 8192);
            int ctx = per_agent * (int)g.names.size();
            const int ctx_cap = 16384;
            if (ctx > ctx_cap) {
                std::cerr << "[Configure] WARNING: effective ctx "
                          << ctx << " exceeds cap " << ctx_cap
                          << " on port " << port << "; truncating. "
                          << "Lower per-agent 'context' in swarm-config.json "
                          << "to avoid Metal OOM." << std::endl;
                ctx = ctx_cap;
            }
            spawn_detached(g_env.llama_server_bin,
                {"-m",g.model,"-c",std::to_string(ctx),"--port",ps,
                 "--n-gpu-layers",std::to_string(g.gpu_layers),
                 "--parallel",std::to_string(g.names.size()),
                 "--metrics",
                 "--slot-save-path",g_env.matrix_slots_dir}, log);
            std::cout << "[Configure] LLAMA :" << port << " x" << g.names.size()
                      << " [" << join(g.names) << "]\n";
        }
    }

    // docker-vllm cold-starts take 1–3 min per model; use 600 s when any are present
    int health_timeout = 240;
    for (const auto& kv : pgs) {
        if (kv.second.backend == "docker-vllm") { health_timeout = 600; break; }
    }
    auto failed = wait_for_health(pgs, health_timeout);
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

    // Start coordinator
    spawn_detached(proj + "/coordinator", {"--config", g_env.active_config_path},
                   proj + "/agent_logs/coordinator.log");

    // Poll until coordinator is actually listening (up to 8 s) instead of a blind sleep
    {
        auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(8);
        bool coord_ready = false;
        while (std::chrono::steady_clock::now() < deadline) {
            std::this_thread::sleep_for(std::chrono::milliseconds(300));
            try {
                httplib::Client cli("127.0.0.1", g_env.coordinator_port);
                cli.set_connection_timeout(1);
                cli.set_read_timeout(2);
                auto r = cli.Get("/api/health");
                if (r && r->status == 200) { coord_ready = true; break; }
            } catch (...) {}
        }
        if (!coord_ready) {
            std::cerr << "[Configure] Warning: coordinator did not respond within 8 s — "
                         "UI health poll may show offline briefly.\n";
        }
    }

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
