#pragma once
// Internal LRU eviction types and helpers for response_cache.cpp.
// Not part of the public API.
#include "agent.h"

#include <chrono>
#include <cstdint>
#include <cstdio>
#include <list>
#include <string>
#include <unordered_map>

namespace response_cache {
namespace impl {

using Clock = std::chrono::steady_clock;

struct Entry {
    std::string response;
    Clock::time_point expires_at;
};

using LruMap = std::unordered_map<std::string,
    std::pair<Entry, std::list<std::string>::iterator>>;

// FNV-1a 64-bit helpers — fast, dependency-free key hashing.
static constexpr uint64_t FNV_OFFSET = 14695981039346656037ULL;
static constexpr uint64_t FNV_PRIME  = 1099511628211ULL;

inline uint64_t fnv1a(uint64_t h, const std::string& s) {
    for (unsigned char c : s) h = (h ^ c) * FNV_PRIME;
    return h;
}

inline uint64_t fnv1a_u32(uint64_t h, uint32_t v) {
    for (int i = 0; i < 4; ++i) { h = (h ^ (v & 0xFF)) * FNV_PRIME; v >>= 8; }
    return h;
}

inline std::string make_key(const Agent& a, const std::string& sys,
                             const std::string& user) {
    uint64_t h = FNV_OFFSET;
    h = fnv1a(h, a.name);
    h = (h ^ '\0') * FNV_PRIME;
    h = fnv1a(h, sys);
    h = (h ^ '\0') * FNV_PRIME;
    h = fnv1a(h, user);
    h = fnv1a_u32(h, static_cast<uint32_t>(a.max_tokens));
    char buf[17];
    snprintf(buf, sizeof(buf), "%016llx", (unsigned long long)h);
    return std::string(buf, 16);
}

// Move the accessed item to the MRU front. Caller must hold the cache mutex.
inline void touch_locked(LruMap& map, std::list<std::string>& lru,
                          LruMap::iterator it) {
    lru.erase(it->second.second);
    lru.push_front(it->first);
    it->second.second = lru.begin();
}

// Evict LRU entries until size <= max_entries. Caller must hold the mutex.
inline void evict_lru_locked(LruMap& map, std::list<std::string>& lru,
                              size_t max_entries, size_t& evictions) {
    while (map.size() > max_entries) {
        const std::string& oldest = lru.back();
        map.erase(oldest);
        lru.pop_back();
        ++evictions;
    }
}

} // namespace impl
} // namespace response_cache
