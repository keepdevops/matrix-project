#include "agent_client_pool.h"
#include "agent_client_pool_queue.h"

#include <condition_variable>
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

std::unique_ptr<httplib::Client> pool_checkout(int port, int read_timeout_secs) {
    return pool_queue::checkout(port, read_timeout_secs);
}

void pool_checkin(int port, std::unique_ptr<httplib::Client> cli) {
    pool_queue::checkin(port, std::move(cli));
}
