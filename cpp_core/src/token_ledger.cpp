#include "token_ledger.h"

#include <algorithm>
#include <iostream>
#include <map>
#include <mutex>
#include <string>

namespace token_ledger {

namespace {
std::map<std::string, Entry> g_ledger;
std::mutex g_mu;
} // namespace

void set_budget(const std::string& session_id, int budget) {
    if (session_id.empty()) return;
    std::lock_guard<std::mutex> lk(g_mu);
    auto& e = g_ledger[session_id];
    if (e.budget == 0 || budget != e.budget) {
        e.budget = budget;
    }
}

void add(const std::string& session_id, long prompt_toks, long completion_toks) {
    if (session_id.empty()) return;
    int delta = 0;
    if (prompt_toks > 0)     delta += static_cast<int>(prompt_toks);
    if (completion_toks > 0) delta += static_cast<int>(completion_toks);
    if (delta <= 0) return;
    std::lock_guard<std::mutex> lk(g_mu);
    auto& e = g_ledger[session_id];
    e.consumed += delta;
    if (e.budget > 0 && e.consumed >= e.budget) {
        std::cerr << "⚠️  [token_ledger] session " << session_id
                  << " budget overrun: consumed=" << e.consumed
                  << " budget=" << e.budget << std::endl;
    }
}

Entry get(const std::string& session_id) {
    if (session_id.empty()) return {};
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_ledger.find(session_id);
    if (it == g_ledger.end()) return {};
    return it->second;
}

void reset(const std::string& session_id) {
    if (session_id.empty()) return;
    std::lock_guard<std::mutex> lk(g_mu);
    g_ledger.erase(session_id);
}

nlohmann::json snapshot(const std::string& session_id) {
    Entry e = get(session_id);
    return {
        {"session_id", session_id},
        {"budget",     e.budget},
        {"consumed",   e.consumed},
        {"remaining",  e.remaining()},
        {"overrun",    e.overrun()},
    };
}

int session_total_consumed() {
    std::lock_guard<std::mutex> lk(g_mu);
    int total = 0;
    for (const auto& kv : g_ledger) total += kv.second.consumed;
    return total;
}

nlohmann::json all_sessions_snapshot() {
    std::lock_guard<std::mutex> lk(g_mu);
    auto arr = nlohmann::json::array();
    for (const auto& kv : g_ledger) {
        arr.push_back({
            {"session_id", kv.first},
            {"budget",     kv.second.budget},
            {"consumed",   kv.second.consumed},
            {"remaining",  kv.second.remaining()},
            {"overrun",    kv.second.overrun()},
        });
    }
    return arr;
}

} // namespace token_ledger
