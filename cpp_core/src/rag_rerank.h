#pragma once
// RAG re-ranking: combines cosine distance with term-overlap score.
// No extra model required — pure string matching.
// Included inline by coordinator_routes_dispatch_prepare.cpp.

#include "rag_client.h"
#include <algorithm>
#include <cctype>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace rag_rerank {

struct ScoredHit {
    rag::Hit hit;
    double   relevance = 0.0; // combined score 0–1, higher = more relevant
};

// Tokenise to lowercase words; strip punctuation.
inline std::unordered_set<std::string> tokenise(const std::string& text) {
    std::unordered_set<std::string> tokens;
    std::string cur;
    for (unsigned char c : text) {
        if (std::isalnum(c)) {
            cur += static_cast<char>(std::tolower(c));
        } else if (!cur.empty()) {
            tokens.insert(cur);
            cur.clear();
        }
    }
    if (!cur.empty()) tokens.insert(cur);
    return tokens;
}

// Jaccard overlap between query tokens and chunk tokens, 0–1.
inline double term_overlap(const std::string& query, const std::string& text) {
    auto qt = tokenise(query);
    auto tt = tokenise(text);
    if (qt.empty() || tt.empty()) return 0.0;
    int common = 0;
    for (const auto& w : qt) if (tt.count(w)) ++common;
    return static_cast<double>(common) /
           static_cast<double>(qt.size() + tt.size() - common);
}

// Reorder hits by combined score: alpha*(1-distance) + (1-alpha)*overlap.
// Returns descending by combined score.
inline std::vector<ScoredHit> rerank(const std::string& query,
                                      const std::vector<rag::Hit>& hits,
                                      double alpha = 0.6) {
    std::vector<ScoredHit> scored;
    scored.reserve(hits.size());
    for (const auto& h : hits) {
        double sim  = std::max(0.0, 1.0 - h.distance);
        double over = term_overlap(query, h.content);
        double rel  = alpha * sim + (1.0 - alpha) * over;
        scored.push_back({h, rel});
    }
    std::sort(scored.begin(), scored.end(),
              [](const ScoredHit& a, const ScoredHit& b) {
                  return a.relevance > b.relevance;
              });
    return scored;
}

} // namespace rag_rerank
