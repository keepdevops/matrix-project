#include "kv_router.h"

#include <algorithm>
#include <mutex>
#include <unordered_map>

namespace kv_router {
namespace {

constexpr size_t kMaxStored = 8192;  // cap per-agent stored prefix bytes

std::mutex g_mu;
std::unordered_map<std::string, std::string> g_last;  // agent -> last prompt

size_t common_prefix_bytes(const std::string& a, const std::string& b) {
    const size_t n = std::min(a.size(), b.size());
    size_t i = 0;
    while (i < n && a[i] == b[i]) ++i;
    return i;
}

} // namespace

void note_prefix(const std::string& agent_name, const std::string& prompt) {
    if (agent_name.empty()) return;
    std::string clipped = prompt.size() > kMaxStored
        ? prompt.substr(0, kMaxStored) : prompt;
    std::lock_guard<std::mutex> lock(g_mu);
    g_last[agent_name] = std::move(clipped);
}

size_t affinity(const std::string& agent_name, const std::string& prompt) {
    std::lock_guard<std::mutex> lock(g_mu);
    auto it = g_last.find(agent_name);
    if (it == g_last.end()) return 0;
    return common_prefix_bytes(it->second, prompt);
}

void rank_by_affinity(std::vector<std::string>& names,
                      const std::string& prompt,
                      size_t min_bytes) {
    if (names.size() < 2) return;
    // Snapshot scores under a single lock to avoid repeated locking.
    std::vector<std::pair<size_t, size_t>> scored;  // (score, original_index)
    scored.reserve(names.size());
    {
        std::lock_guard<std::mutex> lock(g_mu);
        for (size_t i = 0; i < names.size(); ++i) {
            auto it = g_last.find(names[i]);
            size_t s = (it == g_last.end())
                ? 0
                : common_prefix_bytes(it->second, prompt);
            if (s < min_bytes) s = 0;  // below threshold: don't reorder
            scored.emplace_back(s, i);
        }
    }
    // Stable sort: higher score first, original index as tiebreaker.
    std::stable_sort(scored.begin(), scored.end(),
        [](const auto& x, const auto& y) {
            if (x.first != y.first) return x.first > y.first;
            return x.second < y.second;
        });
    std::vector<std::string> reordered;
    reordered.reserve(names.size());
    for (const auto& p : scored) reordered.push_back(names[p.second]);
    names.swap(reordered);
}

} // namespace kv_router
