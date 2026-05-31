#include "agent_stream_pool.h"

#include <deque>
#include <map>
#include <mutex>

static constexpr int STREAM_POOL_MAX = 4;

struct PortClients {
    std::deque<std::unique_ptr<httplib::Client>> idle;
    std::mutex mu;
};

static std::map<int, std::unique_ptr<PortClients>> g_stream_pools;
static std::mutex g_stream_pool_map_mu;

std::unique_ptr<httplib::Client> stream_pool_checkout(int port, int read_timeout_secs) {
    {
        std::lock_guard<std::mutex> lk(g_stream_pool_map_mu);
        if (!g_stream_pools.count(port))
            g_stream_pools[port] = std::make_unique<PortClients>();
    }
    PortClients* pc = g_stream_pools[port].get();
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

void stream_pool_checkin(int port, std::unique_ptr<httplib::Client> cli) {
    std::lock_guard<std::mutex> lk(g_stream_pool_map_mu);
    auto it = g_stream_pools.find(port);
    if (it == g_stream_pools.end()) return;
    PortClients* pc = it->second.get();
    std::lock_guard<std::mutex> pc_lk(pc->mu);
    if ((int)pc->idle.size() < STREAM_POOL_MAX)
        pc->idle.push_back(std::move(cli));
}
