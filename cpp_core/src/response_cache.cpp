#include "response_cache.h"
#include "response_cache_evict.h"

#include <mutex>
#include <optional>

namespace response_cache {
namespace {

struct State {
    bool   enabled    = false;
    int    ttl_secs   = 600;
    size_t max_entries = 256;
    size_t hits = 0, misses = 0, inserts = 0, evictions = 0;

    std::list<std::string> lru;
    impl::LruMap           map;
};

std::mutex g_mu;
State      g_state;

} // namespace

void set_enabled(bool on) {
    std::lock_guard<std::mutex> lock(g_mu);
    g_state.enabled = on;
}

bool is_enabled() {
    std::lock_guard<std::mutex> lock(g_mu);
    return g_state.enabled;
}

void configure(int ttl_secs, size_t max_entries) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (ttl_secs > 0)    g_state.ttl_secs    = ttl_secs;
    if (max_entries > 0) g_state.max_entries  = max_entries;
    impl::evict_lru_locked(g_state.map, g_state.lru,
                           g_state.max_entries, g_state.evictions);
}

std::optional<std::string> lookup(const Agent& agent,
                                  const std::string& system_prompt,
                                  const std::string& user_prompt) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (!g_state.enabled) return std::nullopt;
    std::string key = impl::make_key(agent, system_prompt, user_prompt);
    auto it = g_state.map.find(key);
    if (it == g_state.map.end()) { ++g_state.misses; return std::nullopt; }
    if (impl::Clock::now() >= it->second.first.expires_at) {
        g_state.lru.erase(it->second.second);
        g_state.map.erase(it);
        ++g_state.misses;
        return std::nullopt;
    }
    impl::touch_locked(g_state.map, g_state.lru, it);
    ++g_state.hits;
    return it->second.first.response;
}

void store(const Agent& agent,
           const std::string& system_prompt,
           const std::string& user_prompt,
           const std::string& response) {
    if (response.empty()) return;
    std::lock_guard<std::mutex> lock(g_mu);
    if (!g_state.enabled) return;
    std::string key = impl::make_key(agent, system_prompt, user_prompt);
    impl::Entry e{response, impl::Clock::now() + std::chrono::seconds(g_state.ttl_secs)};
    auto it = g_state.map.find(key);
    if (it != g_state.map.end()) {
        it->second.first = std::move(e);
        impl::touch_locked(g_state.map, g_state.lru, it);
        return;
    }
    g_state.lru.push_front(key);
    g_state.map.emplace(key, std::make_pair(std::move(e), g_state.lru.begin()));
    ++g_state.inserts;
    impl::evict_lru_locked(g_state.map, g_state.lru,
                           g_state.max_entries, g_state.evictions);
}

void clear() {
    std::lock_guard<std::mutex> lock(g_mu);
    g_state.map.clear();
    g_state.lru.clear();
}

Stats stats() {
    std::lock_guard<std::mutex> lock(g_mu);
    Stats s;
    s.hits     = g_state.hits;
    s.misses   = g_state.misses;
    s.inserts  = g_state.inserts;
    s.evictions = g_state.evictions;
    s.size     = g_state.map.size();
    s.enabled  = g_state.enabled;
    s.ttl_secs = g_state.ttl_secs;
    s.max_entries = g_state.max_entries;
    return s;
}

} // namespace response_cache
