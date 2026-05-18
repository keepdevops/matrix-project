#pragma once
// Reusable per-port HTTP client pool. Each client is checked out for one
// request at a time and returned afterwards. Separate instances are used for
// streaming and non-streaming callers (they have different lifetime profiles).

#include "httplib.h"

#include <deque>
#include <map>
#include <memory>
#include <mutex>

struct HttpClientPool {
    static constexpr int MAX_PER_PORT = 4;

    struct PortClients {
        std::deque<std::unique_ptr<httplib::Client>> idle;
        std::mutex mu;
    };

    std::map<int, std::unique_ptr<PortClients>> ports;
    std::mutex map_mu;

    std::unique_ptr<httplib::Client> checkout(int port, int read_timeout_secs) {
        {
            std::lock_guard<std::mutex> lk(map_mu);
            if (!ports.count(port)) ports[port] = std::make_unique<PortClients>();
        }
        PortClients* pc = ports[port].get();
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

    void checkin(int port, std::unique_ptr<httplib::Client> cli) {
        std::lock_guard<std::mutex> lk(map_mu);
        auto it = ports.find(port);
        if (it == ports.end()) return;
        PortClients* pc = it->second.get();
        std::lock_guard<std::mutex> lk2(pc->mu);
        if ((int)pc->idle.size() < MAX_PER_PORT)
            pc->idle.push_back(std::move(cli));
    }
};
