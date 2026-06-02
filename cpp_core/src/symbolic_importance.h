#pragma once
// Symbolic importance scoring for agent outputs.
// Uses norm (length) and entropy (lexical diversity) heuristics.
// No model required — training-free, runs inline after dispatch.

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace symbolic_importance {

/// Normalised length score relative to peer average. Caps at 1.0.
inline double norm_score(const std::string& text, double peer_avg_len) {
    if (peer_avg_len <= 0.0 || text.empty()) return 0.0;
    return std::min(1.0, static_cast<double>(text.size()) / (peer_avg_len * 1.5));
}

/// Entropy proxy: unique tokens / total tokens (lexical diversity), 0–1.
inline double entropy_score(const std::string& text) {
    if (text.empty()) return 0.0;
    std::istringstream ss(text);
    std::string tok;
    std::vector<std::string> tokens;
    std::set<std::string> unique;
    while (ss >> tok) { tokens.push_back(tok); unique.insert(tok); }
    if (tokens.empty()) return 0.0;
    return static_cast<double>(unique.size()) / static_cast<double>(tokens.size());
}

/// Combined importance score 0–1: 0.6 * norm + 0.4 * entropy.
inline double score(const std::string& text, double peer_avg_len) {
    return 0.6 * norm_score(text, peer_avg_len) + 0.4 * entropy_score(text);
}

/// Rank a map of agent→text by combined importance. Returns sorted descending.
inline std::vector<std::pair<std::string, double>>
rank(const std::map<std::string, std::string>& outputs) {
    if (outputs.empty()) return {};
    double avg_len = 0.0;
    for (const auto& [k, v] : outputs) avg_len += v.size();
    avg_len /= static_cast<double>(outputs.size());

    std::vector<std::pair<std::string, double>> ranked;
    ranked.reserve(outputs.size());
    for (const auto& [k, v] : outputs)
        ranked.emplace_back(k, score(v, avg_len));
    std::sort(ranked.begin(), ranked.end(),
              [](const auto& a, const auto& b) { return a.second > b.second; });
    return ranked;
}

/// Average importance across all agents.
inline double average(const std::vector<std::pair<std::string, double>>& ranked) {
    if (ranked.empty()) return 0.0;
    double sum = 0.0;
    for (const auto& p : ranked) sum += p.second;
    return sum / static_cast<double>(ranked.size());
}

} // namespace symbolic_importance
