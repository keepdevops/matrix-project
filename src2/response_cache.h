#pragma once
// Exact-prompt response cache for agent calls. Keyed by
// (agent_name, system_prompt, user_prompt, max_tokens). Entries expire after
// `ttl_secs` and the store is capped at `max_entries` (LRU eviction).
//
// Disabled by default — enable via /api/cache/config or coordinator startup.
// On miss the caller proceeds normally and is expected to insert the result.
//
// Not a semantic cache: only identical prompts hit. The win is replays
// (rerunning a broadcast, dev iteration) and any genuine duplicate calls
// inside a single user request (e.g. flat-mode with two agents that share
// the exact same system prompt + user prompt).

#include "agent.h"

#include <cstddef>
#include <optional>
#include <string>

namespace response_cache {

struct Stats {
    size_t hits = 0;
    size_t misses = 0;
    size_t inserts = 0;
    size_t evictions = 0;
    size_t size = 0;
    bool enabled = false;
    int ttl_secs = 0;
    size_t max_entries = 0;
};

void set_enabled(bool on);
bool is_enabled();
void configure(int ttl_secs, size_t max_entries);

// Returns cached response if present and not expired; nullopt otherwise.
std::optional<std::string> lookup(const Agent& agent,
                                  const std::string& system_prompt,
                                  const std::string& user_prompt);

// Store a successful response. No-op if disabled or `response` is empty.
void store(const Agent& agent,
           const std::string& system_prompt,
           const std::string& user_prompt,
           const std::string& response);

void clear();
Stats stats();

}  // namespace response_cache
