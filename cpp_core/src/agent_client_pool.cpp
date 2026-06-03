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

// ── per-port concurrency + token-budget semaphore ────────────────────────────

struct PortSemaphore {
    // Request-count gate (max_concurrency; 0 = unlimited)
    int limit = 0, count = 0, waiting = 0;
    // KV token budget gate (kv_token_budget; 0 = disabled)
    int token_budget = 0;
    int tokens_in_flight = 0;

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

    // Token-budget gate: block until estimated tokens fit within the budget.
    // estimated = min(prompt_cap, max_input_tokens) + max_tokens for this agent.
    void acquire_tokens(int estimated) {
        if (token_budget <= 0 || estimated <= 0) return;
        std::unique_lock<std::mutex> lk(mu);
        cv.wait(lk, [this, estimated] {
            return tokens_in_flight + estimated <= token_budget;
        });
        tokens_in_flight += estimated;
    }
    // Release: deduct actual tokens used (from response usage); fall back to estimate.
    void release_tokens(int actual) {
        if (token_budget <= 0 || actual <= 0) return;
        std::lock_guard<std::mutex> lk(mu);
        tokens_in_flight = std::max(0, tokens_in_flight - actual);
        cv.notify_all();
    }
};

static std::map<int, std::unique_ptr<PortSemaphore>> port_semaphores;

void init_port_concurrency(const std::vector<Agent>& agents) {
    for (const auto& a : agents) {
        bool needs_sem = (a.max_concurrency > 0 || a.kv_token_budget > 0);
        if (needs_sem && port_semaphores.find(a.port) == port_semaphores.end()) {
            auto sem = std::make_unique<PortSemaphore>();
            sem->limit        = a.max_concurrency;
            sem->token_budget = a.kv_token_budget;
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

void semaphore_acquire_tokens(int port, int estimated_tokens) {
    auto it = port_semaphores.find(port);
    if (it != port_semaphores.end()) it->second->acquire_tokens(estimated_tokens);
}

void semaphore_release_tokens(int port, int actual_tokens) {
    auto it = port_semaphores.find(port);
    if (it != port_semaphores.end()) it->second->release_tokens(actual_tokens);
}

// ── HTTP client pool ──────────────────────────────────────────────────────────

std::unique_ptr<httplib::Client> pool_checkout(int port, int read_timeout_secs) {
    return pool_queue::checkout(port, read_timeout_secs);
}

void pool_checkin(int port, std::unique_ptr<httplib::Client> cli) {
    pool_queue::checkin(port, std::move(cli));
}
