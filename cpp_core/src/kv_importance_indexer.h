#pragma once
// KV slot importance scoring — training-free proxy using norm, entropy,
// and recency heuristics. Guides importance-ordered partial KV eviction.

#include "agent.h"
#include "kv_layer_entropy.h"
#include "symbolic_importance.h"
#include "json.hpp"
#include <algorithm>
#include <map>
#include <string>
#include <vector>

namespace kv_importance {

struct SlotScore {
    int    port       = 0;
    double importance = 0.5; // 0 = evict first, 1 = keep

    bool should_evict(double threshold = 0.3) const {
        return importance <= threshold;
    }

    nlohmann::json to_json() const {
        return {{"port", port}, {"importance", importance},
                {"should_evict", should_evict()}};
    }
};

/// Score a single port's KV importance.
/// recent_output: last response text from this port (may be empty).
/// age_turns: how many dispatch rounds since this port last responded.
/// kv_fill_ratio: current fill 0–1 (high fill = under pressure).
inline SlotScore score_port(int port,
                             const std::string& recent_output,
                             int age_turns,
                             double kv_fill_ratio,
                             const kv_layer::LayerProfile* layer = nullptr) {
    SlotScore s;
    s.port = port;

    // Text-based importance (norm + entropy) when available
    double text_score = 0.5; // neutral when no output
    if (!recent_output.empty()) {
        text_score = symbolic_importance::entropy_score(recent_output) * 0.7
                   + std::min(1.0, recent_output.size() / 2000.0) * 0.3;
    }

    // Recency: decay by 0.1 per idle turn, floor at 0
    double recency = std::max(0.0, 1.0 - age_turns * 0.1);

    // High fill = more pressure = lower effective importance (trigger eviction)
    double pressure_penalty = kv_fill_ratio * 0.2;

    double layer_score = 0.0;
    if (layer) layer_score = (1.0 - layer->eviction_priority) * 0.3;

    s.importance = std::max(0.0, std::min(1.0,
        text_score * (layer ? 0.35 : 0.5)
        + recency * 0.3
        + layer_score
        - pressure_penalty + 0.2));
    return s;
}

/// Rank all ports ascending by importance (lowest first = evict first).
inline std::vector<SlotScore> rank_ports(
    const std::vector<Agent>& agents,
    const std::map<int, std::string>& port_recent_outputs,
    const std::map<int, int>& port_age_turns,
    const std::map<int, double>& port_kv_fills)
{
    std::map<int, SlotScore> by_port;
    for (const auto& a : agents) {
        if (by_port.count(a.port)) continue;
        std::string out;
        int age = 0;
        double fill = 0.0;
        if (port_recent_outputs.count(a.port)) out  = port_recent_outputs.at(a.port);
        if (port_age_turns.count(a.port))      age  = port_age_turns.at(a.port);
        if (port_kv_fills.count(a.port))       fill = port_kv_fills.at(a.port);
        by_port[a.port] = score_port(a.port, out, age, fill);
    }
    std::vector<SlotScore> ranked;
    ranked.reserve(by_port.size());
    for (const auto& [p, s] : by_port) ranked.push_back(s);
    std::sort(ranked.begin(), ranked.end(),
              [](const SlotScore& a, const SlotScore& b) {
                  return a.importance < b.importance; // ascending: evict first
              });
    return ranked;
}

} // namespace kv_importance
