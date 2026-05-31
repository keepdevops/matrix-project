#include "router_endpoint.h"
#include "../agent_health.h"
#include "../httplib.h"

#include <chrono>
#include <future>
#include <iostream>
#include <mutex>
#include <unordered_map>

namespace router_endpoint {
namespace {

static constexpr int READY_TTL_SECS = 30;

struct PortReadyCache {
    struct Entry {
        bool ok;
        std::chrono::steady_clock::time_point expiry;
    };
    std::unordered_map<int, Entry> m;
    std::mutex mu;

    bool get(int port, bool& out) {
        std::lock_guard<std::mutex> lk(mu);
        auto it = m.find(port);
        if (it == m.end() || std::chrono::steady_clock::now() > it->second.expiry)
            return false;
        out = it->second.ok;
        return true;
    }
    void set(int port, bool ok) {
        std::lock_guard<std::mutex> lk(mu);
        m[port] = {ok, std::chrono::steady_clock::now()
                       + std::chrono::seconds(READY_TTL_SECS)};
    }
};

PortReadyCache g_ready_cache;

}  // namespace

bool endpoint_ready(const Agent& a) {
    bool cached = false;
    if (g_ready_cache.get(a.port, cached)) return cached;

    const bool openai_backend = a.engine == "mlx" || a.backend == "mlx"
        || a.backend == "vllm" || a.backend == "docker-vllm"
        || a.backend == "docker";
    const char* path = openai_backend ? "/v1/models" : "/health";
    bool ok = false;
    try {
        httplib::Client cli("127.0.0.1", a.port);
        cli.set_connection_timeout(1);
        cli.set_read_timeout(1);
        ok = static_cast<bool>(cli.Get(path));
    } catch (...) {}
    g_ready_cache.set(a.port, ok);
    return ok;
}

std::vector<Agent> filter_reachable(const std::vector<Agent>& agents,
                                    nlohmann::json& excluded_unreachable) {
    const size_t n = agents.size();
    std::vector<std::future<bool>> ready_futures;
    ready_futures.reserve(n);
    for (const auto& a : agents)
        ready_futures.push_back(std::async(std::launch::async,
            [&a]() { return endpoint_ready(a); }));

    std::vector<Agent> reachable;
    reachable.reserve(n);
    for (size_t i = 0; i < n; ++i) {
        if (ready_futures[i].get()) {
            reachable.push_back(agents[i]);
        } else {
            excluded_unreachable.push_back(agents[i].name);
            agent_health::record(agents[i].name, false);
            std::cerr << "🔌 [router] excluding unreachable agent '" << agents[i].name
                      << "' on port " << agents[i].port << std::endl;
        }
    }
    return reachable;
}

}  // namespace router_endpoint
