#include "proxy_configure_kill_prepare.h"

#include "matrix_env.h"

#include <chrono>
#include <cstdlib>
#include <iostream>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

void proxy_configure_kill_old_and_prepare_dirs(const std::string& proj) {
    // Match coordinator by argv suffix (`coordinator --config`), not absolute
    // path — instances launched from the project dir won't match a pattern
    // containing the full project path.
    system("pkill -f llama-server 2>/dev/null");
    system("pkill -f 'llama_cpp.server' 2>/dev/null");
    system("pkill -f 'mlx_lm.server' 2>/dev/null");
    system("pkill -f 'vllm.entrypoints' 2>/dev/null");
    system("pkill -f 'docker model run' 2>/dev/null");
    system("pkill -f 'coordinator --config' 2>/dev/null");
    system("lsof -ti:8080,8081,8082,8083,8084,8085,8086,8087,8088,8089,8090 | xargs kill -9 2>/dev/null");
    std::this_thread::sleep_for(std::chrono::seconds(5));
    mkdir(g_env.matrix_slots_dir.c_str(), 0755);
    mkdir((proj + "/logs").c_str(), 0755);
    mkdir((proj + "/agent_logs").c_str(), 0755);
}
