#pragma once
// Inline HTTP client pool — included only by agent_client_pool.cpp.

#include "httplib.h"
#include <deque>
#include <map>
#include <memory>
#include <mutex>

namespace pool_queue {

static constexpr int MAX_POOL_PER_PORT = 4;

struct PortClients {
    std::deque<std::unique_ptr<httplib::Client>> idle;
    std::mutex mu;
};

static std::map<int, std::unique_ptr<PortClients>> g_pools;
static std::mutex g_pool_map_mu;

inline std::unique_ptr<httplib::Client> checkout(int port, int read_timeout_secs) {
    {
        std::lock_guard<std::mutex> lk(g_pool_map_mu);
        if (!g_pools.count(port))
            g_pools[port] = std::make_unique<PortClients>();
    }
    PortClients* pc = g_pools[port].get();
    {
        std::lock_guard<std::mutex> lk(pc->mu);
        if (!pc->idle.empty()) {
            auto cli = std::move(pc->idle.front());
            pc->idle.pop_front();
            cli->set_read_timeout(read_timeout_secs);
            return cli;
        }
    }
    auto cli = std::make_unique<httplib::Client>("127.0.0.1", port);
    cli->set_keep_alive(true);
    cli->set_connection_timeout(5);
    cli->set_read_timeout(read_timeout_secs);
    return cli;
}

inline void checkin(int port, std::unique_ptr<httplib::Client> cli) {
    std::lock_guard<std::mutex> lk(g_pool_map_mu);
    auto it = g_pools.find(port);
    if (it == g_pools.end()) return;
    PortClients* pc = it->second.get();
    std::lock_guard<std::mutex> pc_lk(pc->mu);
    if ((int)pc->idle.size() < MAX_POOL_PER_PORT)
        pc->idle.push_back(std::move(cli));
}

} // namespace pool_queue
