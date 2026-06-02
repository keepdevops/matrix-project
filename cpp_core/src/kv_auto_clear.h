#pragma once
// Auto KV-cache clear — included only by coordinator_routes_dispatch.cpp.
// Clears llama-server KV caches when pressure is high and the query
// embedding diverges significantly from the previous query (topic switch).

#include "agent.h"
#include "coordinator_kv_ops.h"
#include "kv_importance_indexer.h"
#include "rag_embed.h"
#include "json.hpp"
#include <cmath>
#include <iostream>
#include <map>
#include <numeric>
#include <string>
#include <vector>

namespace kv_auto_clear {

struct Config {
    bool   enabled              = false;
    double pressure_threshold   = 0.75;
    double divergence_threshold = 0.6;
};

struct State {
    std::vector<double> last_embedding;
};

inline Config load(const nlohmann::json& coordinator_block) {
    Config cfg;
    if (!coordinator_block.contains("auto_clear_kv")) return cfg;
    const auto& a = coordinator_block["auto_clear_kv"];
    cfg.enabled              = a.value("enabled", false);
    cfg.pressure_threshold   = a.value("pressure_threshold", 0.75);
    cfg.divergence_threshold = a.value("divergence_threshold", 0.6);
    return cfg;
}

inline double cosine_distance(const std::vector<double>& a, const std::vector<double>& b) {
    if (a.size() != b.size() || a.empty()) return 1.0;
    double dot = 0.0, na = 0.0, nb = 0.0;
    for (size_t i = 0; i < a.size(); ++i) {
        dot += a[i] * b[i];
        na  += a[i] * a[i];
        nb  += b[i] * b[i];
    }
    if (na <= 0.0 || nb <= 0.0) return 1.0;
    return 1.0 - dot / (std::sqrt(na) * std::sqrt(nb));
}

// Returns true if auto-clear should fire. Updates st.last_embedding.
inline bool should_clear(State& st, const std::string& query, double kv_pressure,
                          const Config& cfg) {
    if (!cfg.enabled || kv_pressure < cfg.pressure_threshold) {
        auto emb = rag::hash_embed(query);
        if (!emb.empty()) st.last_embedding = emb;
        return false;
    }
    auto emb = rag::hash_embed(query);
    if (emb.empty()) return false;
    bool fire = false;
    if (!st.last_embedding.empty()) {
        double dist = cosine_distance(st.last_embedding, emb);
        fire = dist > cfg.divergence_threshold;
        if (fire)
            std::cout << "🔄 [kv_auto_clear] pressure=" << (int)(kv_pressure * 100)
                      << "% dist=" << dist << " > " << cfg.divergence_threshold
                      << " — auto-clearing KV" << std::endl;
    }
    st.last_embedding = emb;
    return fire;
}

// Clear llama KV caches. When scores is non-null, only clears ports whose
// importance ≤ threshold (importance-ordered partial eviction).
inline void clear_kv(const std::vector<Agent>& agents,
                     const std::vector<kv_importance::SlotScore>* scores = nullptr,
                     double importance_threshold = 1.0) {
    std::map<int,int> slots;
    for (const auto& a : agents) {
        if (scores) {
            bool low = false;
            for (const auto& s : *scores)
                if (s.port == a.port && s.should_evict(importance_threshold)) { low = true; break; }
            if (!low) {
                std::cout << "⏭️  [kv_auto_clear] port:" << a.port << " retained (importance)" << std::endl;
                continue;
            }
        }
        slots[a.port] = 0;
    }
    if (slots.empty()) { std::cout << "⏭️  [kv_auto_clear] all ports retained" << std::endl; return; }
    auto results = coordinator_kv_ops::clear_kv_on_ports(slots);
    int ok = 0;
    for (const auto& r : results) if (r.second.empty() || r.second == "ok") ++ok;
    std::cout << "✅ [kv_auto_clear] cleared " << ok << "/" << results.size() << " port(s)" << std::endl;
}

} // namespace kv_auto_clear
