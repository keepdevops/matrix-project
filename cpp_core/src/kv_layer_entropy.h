#pragma once
// Layer-aware KV entropy scoring.
// Segments context into early/middle/recent tiers and scores entropy per tier.
// Recent context always gets lowest eviction priority (preserve short-term state).

#include "symbolic_importance.h"
#include <algorithm>
#include <map>
#include <string>
#include <vector>

namespace kv_layer {

struct LayerProfile {
    int    port            = 0;
    double early_entropy   = 0.0;  // first 25% of context
    double middle_entropy  = 0.0;  // middle 50%
    double recent_entropy  = 0.0;  // last 25%
    // 0=keep, 1=evict — recent always lowest priority
    double eviction_priority = 0.5;
};

/// Score entropy of a text segment.
inline double segment_entropy(const std::string& text) {
    return symbolic_importance::entropy_score(text);
}

/// Profile a port's context into three tiers and compute eviction priority.
inline LayerProfile profile(int port, const std::string& full_context) {
    LayerProfile p;
    p.port = port;
    if (full_context.empty()) { p.eviction_priority = 1.0; return p; }

    size_t n     = full_context.size();
    size_t q1    = n / 4;
    size_t q3    = n * 3 / 4;

    std::string early  = full_context.substr(0, q1);
    std::string middle = full_context.substr(q1, q3 - q1);
    std::string recent = full_context.substr(q3);

    p.early_entropy  = segment_entropy(early);
    p.middle_entropy = segment_entropy(middle);
    p.recent_entropy = segment_entropy(recent);

    // High early entropy = valuable early context, lower eviction priority
    // Recent always preserved most aggressively (weight 0.1 only)
    p.eviction_priority = std::max(0.0, std::min(1.0,
        1.0 - p.early_entropy  * 0.6
            - p.middle_entropy * 0.3
            - p.recent_entropy * 0.1));

    return p;
}

/// Rank ports by eviction priority descending (highest = evict first).
inline std::vector<LayerProfile> rank_for_eviction(
    const std::map<int, std::string>& port_contexts)
{
    std::vector<LayerProfile> profiles;
    profiles.reserve(port_contexts.size());
    for (const auto& [port, ctx] : port_contexts)
        profiles.push_back(profile(port, ctx));
    std::sort(profiles.begin(), profiles.end(),
              [](const LayerProfile& a, const LayerProfile& b) {
                  return a.eviction_priority > b.eviction_priority;
              });
    return profiles;
}

} // namespace kv_layer
