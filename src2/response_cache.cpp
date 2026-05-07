#include "response_cache.h"

#include <chrono>
#include <list>
#include <mutex>
#include <string>
#include <unordered_map>

namespace response_cache {
namespace {

using Clock = std::chrono::steady_clock;

struct Entry {
    std::string response;
    Clock::time_point expires_at;
};

struct State {
    bool enabled = false;
    int ttl_secs = 600;          // 10 min default
    size_t max_entries = 256;
    size_t hits = 0;
    size_t misses = 0;
    size_t inserts = 0;
    size_t evictions = 0;

    // LRU: list holds keys MRU-first; map holds entry + iterator into list.
    std::list<std::string> lru;
    std::unordered_map<std::string,
        std::pair<Entry, std::list<std::string>::iterator>> map;
};

std::mutex g_mu;
State g_state;

std::string make_key(const Agent& a, const std::string& sys,
                     const std::string& user) {
    // No need to hash — std::unordered_map will hash the string for us.
    // Use sentinels that can't appear in any field (NUL).
    std::string k;
    k.reserve(a.name.size() + sys.size() + user.size() + 32);
    k.append(a.name).push_back('\0');
    k.append(sys).push_back('\0');
    k.append(user).push_back('\0');
    k.append(std::to_string(a.max_tokens));
    return k;
}

void touch_locked(std::unordered_map<std::string,
                  std::pair<Entry, std::list<std::string>::iterator>>::iterator it) {
    g_state.lru.erase(it->second.second);
    g_state.lru.push_front(it->first);
    it->second.second = g_state.lru.begin();
}

}  // namespace

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
    if (ttl_secs > 0) g_state.ttl_secs = ttl_secs;
    if (max_entries > 0) g_state.max_entries = max_entries;
    while (g_state.lru.size() > g_state.max_entries) {
        const std::string& oldest = g_state.lru.back();
        g_state.map.erase(oldest);
        g_state.lru.pop_back();
        ++g_state.evictions;
    }
}

std::optional<std::string> lookup(const Agent& agent,
                                  const std::string& system_prompt,
                                  const std::string& user_prompt) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (!g_state.enabled) return std::nullopt;
    std::string key = make_key(agent, system_prompt, user_prompt);
    auto it = g_state.map.find(key);
    if (it == g_state.map.end()) {
        ++g_state.misses;
        return std::nullopt;
    }
    if (Clock::now() >= it->second.first.expires_at) {
        // Expired — drop.
        g_state.lru.erase(it->second.second);
        g_state.map.erase(it);
        ++g_state.misses;
        return std::nullopt;
    }
    touch_locked(it);
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
    std::string key = make_key(agent, system_prompt, user_prompt);
    Entry e{response, Clock::now() + std::chrono::seconds(g_state.ttl_secs)};
    auto it = g_state.map.find(key);
    if (it != g_state.map.end()) {
        it->second.first = std::move(e);
        touch_locked(it);
        return;
    }
    g_state.lru.push_front(key);
    g_state.map.emplace(key, std::make_pair(std::move(e), g_state.lru.begin()));
    ++g_state.inserts;
    while (g_state.map.size() > g_state.max_entries) {
        const std::string& oldest = g_state.lru.back();
        g_state.map.erase(oldest);
        g_state.lru.pop_back();
        ++g_state.evictions;
    }
}

void clear() {
    std::lock_guard<std::mutex> lock(g_mu);
    g_state.map.clear();
    g_state.lru.clear();
}

Stats stats() {
    std::lock_guard<std::mutex> lock(g_mu);
    Stats s;
    s.hits = g_state.hits;
    s.misses = g_state.misses;
    s.inserts = g_state.inserts;
    s.evictions = g_state.evictions;
    s.size = g_state.map.size();
    s.enabled = g_state.enabled;
    s.ttl_secs = g_state.ttl_secs;
    s.max_entries = g_state.max_entries;
    return s;
}

}  // namespace response_cache
