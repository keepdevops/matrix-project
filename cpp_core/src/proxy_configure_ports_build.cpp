#include "proxy_configure_ports.h"
#include "config/path_expand.h"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <map>
#include <set>
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>

namespace {

bool is_port_available(int port) {
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

bool ends_with_gguf(const std::string& s) {
    return s.size() > 5 && s.compare(s.size() - 5, 5, ".gguf") == 0;
}

}  // namespace

PortBuildResult proxy_configure_build_port_groups(nlohmann::json agents) {
    PortBuildResult result;
    result.agents = std::move(agents);

    std::map<std::string, int> key_to_port;
    int next_port = 8080;
    std::set<int> fixed_ports;
    for (const auto& a : result.agents) {
        if (a.contains("port") && a["port"].is_number_integer()) {
            int p = a["port"].get<int>();
            if (p > 0) fixed_ports.insert(p);
        }
    }

    for (auto& a : result.agents) {
        if (a.contains("model") && a["model"].is_string())
            a["model"] = coordinator_config::expand_model_path(a["model"].get<std::string>());
        if (a.contains("draft_model") && a["draft_model"].is_string())
            a["draft_model"] = coordinator_config::expand_model_path(a["draft_model"].get<std::string>());
    }

    for (auto& a : result.agents) {
        if (a.value("coordinator", "") == "mlx") continue;

        std::string model = a["model"].get<std::string>();
        std::string sg    = a.value("server_group", "");
        std::string bk = a.contains("backend") && !a["backend"].get<std::string>().empty()
                         ? a["backend"].get<std::string>()
                         : a.contains("engine") && !a["engine"].get<std::string>().empty()
                           ? a["engine"].get<std::string>()
                           : std::string(ends_with_gguf(model) ? "llama" : "mlx");
        std::string key;
        int fixed_port = a.contains("port") ? a["port"].get<int>() : -1;
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
        auto& g = result.pgs[port];
        float gmu = a.value("gpu_mem_util", 0.75f);
        int default_gpu_layers = (bk == "llama") ? 99 : 0;
        int agent_n_batch = a.value("n_batch", 0);
        if (g.model.empty()) {
            g = {model, bk, a["context"].get<int>(), a.value("gpu_layers", default_gpu_layers), 0, gmu, {}, "", 0};
            g.n_batch = agent_n_batch;
        } else {
            if (g.backend != bk || g.model != model) {
                result.ok = false;
                result.status = 400;
                result.body = {
                    {"error", "Port " + std::to_string(port)
                        + " is assigned to incompatible servers. Put agents that use different backends or models on different ports."},
                    {"port", port},
                    {"existing_backend", g.backend}, {"existing_model", g.model},
                    {"agent", a["name"].get<std::string>()},
                    {"agent_backend", bk}, {"agent_model", model}
                };
                return result;
            }
            g.context = std::max(g.context, a["context"].get<int>());
            if (agent_n_batch > 0)
                g.n_batch = (g.n_batch == 0) ? agent_n_batch : std::min(g.n_batch, agent_n_batch);
        }
        g.names.push_back(a["name"].get<std::string>());
        if (a.value("flash_attn", false)) g.flash_attn = true;
        if (a.contains("extra_args") && a["extra_args"].is_array()) {
            for (const auto& arg : a["extra_args"]) {
                if (arg.is_string()) {
                    const std::string s = arg.get<std::string>();
                    if (std::find(g.extra_args.begin(), g.extra_args.end(), s) == g.extra_args.end())
                        g.extra_args.push_back(s);
                }
            }
        }
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

    result.ok = true;
    result.status = 200;
    return result;
}
