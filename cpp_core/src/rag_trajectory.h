#pragma once
// RAG trajectory ring buffer — captures query, embeddings, and hit scores
// for each retrieval event. Used by the distillation export pipeline.

#include "json.hpp"
#include <algorithm>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace rag_trajectory {

struct Entry {
    std::string            session_id;
    std::string            run_id;
    std::string            query;
    std::vector<double>    query_embedding; // may be empty if embed unavailable
    nlohmann::json         hits;            // array of {source, distance, relevance?}
    bool                   reranked           = false;
    long long              timestamp_ms       = 0;
    double                 kv_pressure_before = 0.0;
    double                 kv_pressure_after  = 0.0;
    nlohmann::json         kv_importance_scores; // port → {importance, should_evict}
};

namespace detail {
inline std::deque<Entry>& buf() {
    static std::deque<Entry> b;
    return b;
}
inline std::mutex& mu() {
    static std::mutex m;
    return m;
}
constexpr size_t MAX_ENTRIES = 500;
} // namespace detail

inline void record(Entry e) {
    std::lock_guard<std::mutex> lk(detail::mu());
    if (detail::buf().size() >= detail::MAX_ENTRIES)
        detail::buf().pop_front();
    detail::buf().push_back(std::move(e));
}

/// Returns all entries (or filtered by session_id if non-empty), newest-first.
inline nlohmann::json snapshot(const std::string& session_id = "") {
    std::lock_guard<std::mutex> lk(detail::mu());
    auto arr = nlohmann::json::array();
    for (auto it = detail::buf().rbegin(); it != detail::buf().rend(); ++it) {
        if (!session_id.empty() && it->session_id != session_id) continue;
        nlohmann::json j = {
            {"session_id",          it->session_id},
            {"run_id",              it->run_id},
            {"query",               it->query},
            {"hits",                it->hits},
            {"reranked",            it->reranked},
            {"timestamp_ms",        it->timestamp_ms},
            {"kv_pressure_before",  it->kv_pressure_before},
            {"kv_pressure_after",   it->kv_pressure_after},
        };
        if (!it->kv_importance_scores.is_null())
            j["kv_importance_scores"] = it->kv_importance_scores;
        if (!it->query_embedding.empty())
            j["query_embedding"] = it->query_embedding;
        arr.push_back(j);
    }
    return arr;
}

inline void clear() {
    std::lock_guard<std::mutex> lk(detail::mu());
    detail::buf().clear();
}

} // namespace rag_trajectory
