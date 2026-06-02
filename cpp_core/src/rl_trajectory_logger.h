#pragma once
// RL Trajectory Logger — central per-run record for the distillation pipeline.
// Collects agent outputs, token accounting, context ops, RAG, contracts,
// and user feedback into a complete trajectory bundle.

#include "trajectory_quality.h"
#include "json.hpp"
#include <algorithm>
#include <deque>
#include <map>
#include <mutex>
#include <sstream>
#include <string>

namespace rl_traj {

struct Trajectory {
    // Identity
    std::string session_id, run_id, mode;
    std::string prompt;
    long long   timestamp_ms = 0;

    // Agent outputs + importance
    std::map<std::string, std::string> agent_outputs;
    std::map<std::string, double>      importance_scores;

    // Token accounting
    int    tokens_consumed = 0;
    int    budget          = 0;
    double tes             = 0.0;

    // Context gate
    bool   gate_triggered  = false;
    double fidelity_ratio  = 1.0;

    // KV state
    bool   kv_auto_cleared     = false;
    double kv_pressure_before  = 0.0;
    double kv_pressure_after   = 0.0;

    // RAG
    nlohmann::json rag_hits    = nlohmann::json::array();
    double         rag_hit_rate = 0.0;

    // Contracts
    nlohmann::json contracts   = nlohmann::json::array();
    bool           any_overrun = false;

    // User feedback (filled asynchronously when annotation arrives)
    int         annotation_rating  = 0; // 1=up, -1=down, 0=none
    std::string annotation_comment;

    // Computed quality score for distillation filtering (-1 = unscored)
    double quality_score = -1.0;

    nlohmann::json to_json() const {
        return {
            {"session_id",        session_id},
            {"run_id",            run_id},
            {"mode",              mode},
            {"prompt",            prompt},
            {"timestamp_ms",      timestamp_ms},
            {"tokens_consumed",   tokens_consumed},
            {"budget",            budget},
            {"tes",               tes},
            {"gate_triggered",    gate_triggered},
            {"fidelity_ratio",    fidelity_ratio},
            {"kv_auto_cleared",   kv_auto_cleared},
            {"kv_pressure_before", kv_pressure_before},
            {"kv_pressure_after",  kv_pressure_after},
            {"rag_hit_rate",      rag_hit_rate},
            {"rag_hits",          rag_hits},
            {"contracts",         contracts},
            {"any_overrun",       any_overrun},
            {"annotation_rating", annotation_rating},
            {"annotation_comment", annotation_comment},
            {"quality_score",    quality_score},
            {"importance_scores", [&]() {
                nlohmann::json j = nlohmann::json::object();
                for (const auto& [k, v] : importance_scores) j[k] = v;
                return j;
            }()},
            {"agent_outputs", [&]() {
                nlohmann::json j = nlohmann::json::object();
                for (const auto& [k, v] : agent_outputs) j[k] = v;
                return j;
            }()},
        };
    }
};

namespace detail {
inline std::deque<Trajectory>& buf() { static std::deque<Trajectory> b; return b; }
inline std::mutex& mu() { static std::mutex m; return m; }
constexpr size_t MAX = 2000;
} // namespace detail

inline void record(Trajectory t) {
    // Compute quality score before inserting
    trajectory_quality::QualityFactors qf;
    qf.tes              = t.tes;
    qf.fidelity_ratio   = t.fidelity_ratio;
    qf.rag_hit_rate     = t.rag_hit_rate;
    qf.annotation_rating = t.annotation_rating;
    qf.any_overrun      = t.any_overrun;
    if (!t.importance_scores.empty()) {
        double s = 0.0;
        for (const auto& [k, v] : t.importance_scores) s += v;
        qf.avg_importance = s / t.importance_scores.size();
    }
    t.quality_score = trajectory_quality::compute(qf);
    std::lock_guard<std::mutex> lk(detail::mu());
    if (detail::buf().size() >= detail::MAX) detail::buf().pop_front();
    detail::buf().push_back(std::move(t));
}

/// Update annotation on an existing trajectory and recompute quality score.
inline bool update_annotation(const std::string& run_id, int rating,
                               const std::string& comment) {
    std::lock_guard<std::mutex> lk(detail::mu());
    for (auto& t : detail::buf()) {
        if (t.run_id != run_id) continue;
        t.annotation_rating  = rating;
        t.annotation_comment = comment;
        trajectory_quality::QualityFactors qf;
        qf.tes = t.tes; qf.fidelity_ratio = t.fidelity_ratio;
        qf.rag_hit_rate = t.rag_hit_rate;
        qf.annotation_rating = rating; qf.any_overrun = t.any_overrun;
        if (!t.importance_scores.empty()) {
            double s = 0.0;
            for (const auto& [k, v] : t.importance_scores) s += v;
            qf.avg_importance = s / t.importance_scores.size();
        }
        t.quality_score = trajectory_quality::compute(qf);
        return true;
    }
    return false;
}

inline nlohmann::json snapshot(const std::string& session_id = "") {
    std::lock_guard<std::mutex> lk(detail::mu());
    auto arr = nlohmann::json::array();
    for (auto it = detail::buf().rbegin(); it != detail::buf().rend(); ++it) {
        if (!session_id.empty() && it->session_id != session_id) continue;
        arr.push_back(it->to_json());
    }
    return arr;
}

inline std::string export_jsonl(const std::string& session_id = "") {
    std::lock_guard<std::mutex> lk(detail::mu());
    std::ostringstream out;
    for (const auto& t : detail::buf()) {
        if (!session_id.empty() && t.session_id != session_id) continue;
        out << t.to_json().dump() << "\n";
    }
    return out.str();
}

/// Filtered export: only emit entries with quality_score >= min_quality
/// (pass min_quality < 0 to include unscored entries).
inline std::string export_jsonl_filtered(const std::string& session_id = "",
                                          double min_quality = -1.0) {
    std::lock_guard<std::mutex> lk(detail::mu());
    std::ostringstream out;
    for (const auto& t : detail::buf()) {
        if (!session_id.empty() && t.session_id != session_id) continue;
        if (min_quality > 0.0 && t.quality_score >= 0.0
            && t.quality_score < min_quality) continue;
        out << t.to_json().dump() << "\n";
    }
    return out.str();
}

inline void clear() {
    std::lock_guard<std::mutex> lk(detail::mu());
    detail::buf().clear();
}

/// Rolling averages over last N trajectories for Prometheus/dashboard.
struct Stats {
    double avg_tes        = 0.0;
    double avg_importance = 0.0;
    double avg_rag_rate   = 0.0;
    size_t count          = 0;
};

inline Stats rolling_stats(size_t n = 50) {
    std::lock_guard<std::mutex> lk(detail::mu());
    Stats s;
    const auto& b = detail::buf();
    size_t start = b.size() > n ? b.size() - n : 0;
    for (size_t i = start; i < b.size(); ++i) {
        s.avg_tes        += b[i].tes;
        s.avg_rag_rate   += b[i].rag_hit_rate;
        double imp = 0.0;
        for (const auto& [k, v] : b[i].importance_scores) imp += v;
        if (!b[i].importance_scores.empty()) imp /= b[i].importance_scores.size();
        s.avg_importance += imp;
        ++s.count;
    }
    if (s.count > 0) {
        s.avg_tes        /= s.count;
        s.avg_importance /= s.count;
        s.avg_rag_rate   /= s.count;
    }
    return s;
}

} // namespace rl_traj
