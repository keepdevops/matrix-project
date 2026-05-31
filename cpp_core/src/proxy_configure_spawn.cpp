#include "proxy_configure.h"
#include "proxy_configure_internal.h"
#include "matrix_env.h"
#include <iostream>
#include <map>
#include <thread>
#include <chrono>
#include <spawn.h>
#include <fcntl.h>
#include <unistd.h>
#include <cstring>
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

static std::string join_names(const std::vector<std::string>& v) {
    std::string r;
    for (size_t i = 0; i < v.size(); ++i) { if (i) r += ", "; r += v[i]; }
    return r;
}

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

    std::vector<char*> argv_ptrs;
    argv_ptrs.push_back(const_cast<char*>(bin.c_str()));
    for (const auto& a : args) argv_ptrs.push_back(const_cast<char*>(a.c_str()));
    argv_ptrs.push_back(nullptr);

    pid_t pid = -1;
    int rc = use_path_search
        ? posix_spawnp(&pid, bin.c_str(), &fa, &attr, argv_ptrs.data(), spawn_environ())
        : posix_spawn (&pid, bin.c_str(), &fa, &attr, argv_ptrs.data(), spawn_environ());
    if (rc != 0) std::cerr << "[spawn] " << bin << ": " << strerror(rc) << "\n";

    posix_spawn_file_actions_destroy(&fa);
    posix_spawnattr_destroy(&attr);
    close(fd);
}

void spawn_inference_servers(const std::map<int, PortGroup>& pgs,
                              const std::string& proj)
{
    int hf_n = 0;
    int llama_n = 0;
    for (const auto& [port, g] : pgs) {
        // Stagger llama loads so multiple large GGUFs don't race unified memory.
        if (g.backend == "llama") {
            if (llama_n++ > 0)
                std::this_thread::sleep_for(std::chrono::seconds(5));
        }
        std::string log = proj + "/agent_logs/" + std::to_string(port) + ".log";
        std::string ps  = std::to_string(port);
        if (g.backend == "docker") {
            std::cout << "[Configure] DOCKER :" << port << " model=" << g.model
                      << " [" << join_names(g.names) << "]\n";
        } else if (g.backend == "mlx") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            spawn_detached(g_env.mlx_python,
                {"-m","mlx_lm","server","--model",g.model,"--port",ps,"--host","127.0.0.1"}, log);
            std::cout << "[Configure] MLX :" << port << " [" << join_names(g.names) << "]\n";
        } else if (g.backend == "vllm") {
            if (hf_n++ > 0) std::this_thread::sleep_for(std::chrono::seconds(5));
            char gmu_buf[16];
            snprintf(gmu_buf, sizeof(gmu_buf), "%.2f", g.gpu_mem_util);
            spawn_detached(g_env.vllm_python,
                {"-m","vllm.entrypoints.openai.api_server","--model",g.model,
                 "--port",ps,"--host","127.0.0.1","--max-model-len",std::to_string(g.context),
                 "--gpu-memory-utilization",std::string(gmu_buf)},
                log, /*use_path_search=*/false);
            std::cout << "[Configure] vLLM :" << port << " gpu_mem=" << gmu_buf
                      << " python=" << g_env.vllm_python
                      << " [" << join_names(g.names) << "]\n";
        } else if (g.backend == "docker-vllm") {
            char gmu_buf[16];
            snprintf(gmu_buf, sizeof(gmu_buf), "%.2f", g.gpu_mem_util);
            spawn_detached("docker",
                {"model","run",g.model,"--backend","vllm","--port",ps,
                 "--gpu-memory-utilization",std::string(gmu_buf),
                 "--max-model-len",std::to_string(g.context)},
                log, /*use_path_search=*/true);
            std::cout << "[Configure] DOCKER-vLLM :" << port << " gpu_mem=" << gmu_buf
                      << " [" << join_names(g.names) << "]\n";
        } else {
            // llama backend
            int ctx = g.context * (int)g.names.size();
            if (ctx > g.ctx_cap) {
                std::cerr << "[Configure] WARNING: effective ctx "
                          << ctx << " exceeds cap " << g.ctx_cap
                          << " on port " << port << "; truncating. "
                          << "Lower per-agent 'context' or set 'ctx_cap' "
                          << "in agent config to suppress." << std::endl;
                ctx = g.ctx_cap;
            }
            // --fit off: llama.cpp b8763 has a contiguity assert bug in the
            // automatic param-fitting path (ggml_reshape_2d); disable it.
            std::vector<std::string> args = {
                "-m", g.model, "-c", std::to_string(ctx), "--port", ps,
                "--n-gpu-layers", std::to_string(g.gpu_layers),
                "--parallel", std::to_string(g.names.size()),
                "--metrics", "--slot-save-path", g_env.matrix_slots_dir,
                "--fit", "off"
            };
            if (g.flash_attn) {
                args.push_back("--flash-attn"); args.push_back("on");
                args.push_back("--cache-type-k"); args.push_back("q8_0");
                args.push_back("--cache-type-v"); args.push_back("q8_0");
            }
            if (g.n_batch > 0) {
                args.push_back("--batch-size");
                args.push_back(std::to_string(g.n_batch));
            }
            if (!g.draft_model.empty()) {
                args.push_back("--model-draft");
                args.push_back(g.draft_model);
                if (g.draft_max > 0) {
                    args.push_back("--draft-max");
                    args.push_back(std::to_string(g.draft_max));
                }
            }
            for (const auto& ea : g.extra_args) args.push_back(ea);
            spawn_detached(g_env.llama_server_bin, args, log);
            std::cout << "[Configure] LLAMA :" << port << " ctx=" << ctx
                      << (g.flash_attn ? " flash_attn+kv_q8" : "")
                      << " x" << g.names.size()
                      << " [" << join_names(g.names) << "]"
                      << (g.draft_model.empty() ? ""
                          : " spec=" + g.draft_model
                            + (g.draft_max > 0 ? "/" + std::to_string(g.draft_max) : ""))
                      << "\n";
        }
    }
}
