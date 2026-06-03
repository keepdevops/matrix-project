// Unit test for the per-port KV token-budget semaphore (Tier 2).
// Verifies: budget gating blocks oversized requests until tokens are released,
// release deducts correctly, and disabled budget (0) is a no-op.

#include "agent.h"
#include "agent_client_pool.h"

#include <atomic>
#include <cassert>
#include <chrono>
#include <iostream>
#include <thread>
#include <vector>

using namespace std::chrono_literals;

int main() {
    // Port 9001 gets a 1000-token budget; port 9002 has no budget (disabled).
    std::vector<Agent> agents;
    Agent a;
    a.name = "budgeted";  a.port = 9001;  a.kv_token_budget = 1000;
    agents.push_back(a);
    Agent b;
    b.name = "unbudgeted"; b.port = 9002; b.kv_token_budget = 0;
    agents.push_back(b);
    init_port_concurrency(agents);

    // ── 1. First acquire fits (600 <= 1000) and returns immediately ──────────
    semaphore_acquire_tokens(9001, 600);  // in-flight = 600

    // ── 2. Second acquire of 600 would overflow (600+600 > 1000) → must block ─
    std::atomic<bool> second_done{false};
    std::thread blocker([&] {
        semaphore_acquire_tokens(9001, 600);  // blocks until ≥200 freed
        second_done.store(true);
    });

    std::this_thread::sleep_for(100ms);
    assert(!second_done.load() && "second acquire must block while budget exhausted");

    // ── 3. Release the first 600 → blocked acquire proceeds ──────────────────
    semaphore_release_tokens(9001, 600);  // in-flight = 0, then blocker takes 600
    blocker.join();
    assert(second_done.load() && "blocked acquire must proceed after release");
    semaphore_release_tokens(9001, 600);  // clean up

    // ── 4. Disabled budget (port 9002) never blocks, even for huge requests ──
    std::atomic<bool> huge_done{false};
    std::thread nogate([&] {
        semaphore_acquire_tokens(9002, 1'000'000);  // no budget → immediate
        huge_done.store(true);
    });
    nogate.join();
    assert(huge_done.load() && "disabled budget must not gate");

    // ── 5. Unknown port is a safe no-op ──────────────────────────────────────
    semaphore_acquire_tokens(9999, 500);   // no semaphore registered → no crash
    semaphore_release_tokens(9999, 500);

    std::cout << "✅ test_kv_token_semaphore: all assertions passed\n";
    return 0;
}
