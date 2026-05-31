#include "agent_client_pool.h"

#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <string>

// ── template-leakage strip ────────────────────────────────────────────────────

std::string strip_template_leakage(std::string s) {
    static const char* markers[] = {
        "<|im_end|>", "<|im_start|>",
        "<|eot_id|>", "<|start_header_id|>",
        "<|endoftext|>",
    };
    size_t cut = std::string::npos;
    for (const char* m : markers) {
        size_t pos = s.find(m);
        if (pos != std::string::npos && pos < cut) cut = pos;
    }
    if (cut != std::string::npos) s.erase(cut);
    while (!s.empty() && (s.back() == '\n' || s.back() == ' ' || s.back() == '\t'))
        s.pop_back();
    return s;
}

// ── per-port concurrency semaphore ────────────────────────────────────────────

struct PortSemaphore {
    int limit = 0, count = 0, waiting = 0;
    std::mutex mu;
    std::condition_variable cv;

    void acquire() {
        if (limit <= 0) return;
        std::unique_lock<std::mutex> lk(mu);
        ++waiting;
        cv.wait(lk, [this] { return count < limit; });
        --waiting;
        ++count;
    }
    bool release_has_waiters() {
        if (limit <= 0) return false;
        std::lock_guard<std::mutex> lk(mu);
        --count;
        cv.notify_one();
        return waiting > 0;
    }
};

static std::map<int, std::unique_ptr<PortSemaphore>> port_semaphores;

void init_port_concurrency(const std::vector<Agent>& agents) {
    for (const auto& a : agents) {
        if (a.max_concurrency > 0 && port_semaphores.find(a.port) == port_semaphores.end()) {
            auto sem = std::make_unique<PortSemaphore>();
            sem->limit = a.max_concurrency;
            port_semaphores[a.port] = std::move(sem);
        }
    }
}

void semaphore_acquire(int port) {
    auto it = port_semaphores.find(port);
    if (it != port_semaphores.end()) it->second->acquire();
}

bool semaphore_release_has_waiters(int port) {
    auto it = port_semaphores.find(port);
    if (it == port_semaphores.end()) return false;
    return it->second->release_has_waiters();
}

// ── HTTP client pool ──────────────────────────────────────────────────────────

static constexpr int MAX_POOL_PER_PORT = 4;

struct PortClients {
    std::deque<std::unique_ptr<httplib::Client>> idle;
    std::mutex mu;
};

static std::map<int, std::unique_ptr<PortClients>> g_pools;
static std::mutex g_pool_map_mu;

std::unique_ptr<httplib::Client> pool_checkout(int port, int read_timeout_secs) {
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

void pool_checkin(int port, std::unique_ptr<httplib::Client> cli) {
    std::lock_guard<std::mutex> lk(g_pool_map_mu);
    auto it = g_pools.find(port);
    if (it == g_pools.end()) return;
    PortClients* pc = it->second.get();
    std::lock_guard<std::mutex> pc_lk(pc->mu);
    if ((int)pc->idle.size() < MAX_POOL_PER_PORT)
        pc->idle.push_back(std::move(cli));
}
