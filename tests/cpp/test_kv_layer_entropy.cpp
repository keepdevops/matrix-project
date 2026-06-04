// MS-91 runtime test: kv_layer::profile() + rank_for_eviction(). The grep-test
// only checked the header *mentions* rank_for_eviction/eviction_priority; here
// the ranking contract actually executes.
//
// We assert the *contract* (ordering, clamp, empty-context rule, port identity)
// rather than exact entropy values, which depend on symbolic_importance and
// would make the test brittle without adding signal.

#include "kv_layer_entropy.h"

#include <cassert>
#include <iostream>
#include <map>
#include <string>

int main() {
    using kv_layer::profile;
    using kv_layer::rank_for_eviction;
    using kv_layer::LayerProfile;

    // ── Empty context → maximum eviction priority (nothing to keep). ─────────
    {
        LayerProfile p = profile(7, "");
        assert(p.port == 7);
        assert(p.eviction_priority == 1.0);
    }

    // ── eviction_priority is always clamped to [0,1]. ───────────────────────
    {
        const std::string text =
            "the quick brown fox jumps over the lazy dog while pondering "
            "entropy and the nature of token importance across layers";
        LayerProfile p = profile(3, text);
        assert(p.port == 3);
        assert(p.eviction_priority >= 0.0 && p.eviction_priority <= 1.0);
    }

    // ── rank_for_eviction: sorted by eviction_priority DESCENDING, ──────────
    //    every input port present exactly once, an empty-context port (1.0)
    //    sorts ahead of a content-bearing one.
    {
        std::map<int, std::string> ctx = {
            {10, ""},  // empty → priority 1.0 → should rank first (evict first)
            {20, "meaningful context with varied tokens and structure here"},
            {30, "another distinct block of contextual tokens to profile now"},
        };
        std::vector<LayerProfile> ranked = rank_for_eviction(ctx);

        assert(ranked.size() == 3);
        // Descending order.
        for (size_t i = 1; i < ranked.size(); ++i)
            assert(ranked[i - 1].eviction_priority >= ranked[i].eviction_priority);
        // Empty-context port (10) is first.
        assert(ranked.front().port == 10);
        assert(ranked.front().eviction_priority == 1.0);
        // All ports preserved, none duplicated.
        std::map<int, int> seen;
        for (const auto& p : ranked) {
            assert(p.eviction_priority >= 0.0 && p.eviction_priority <= 1.0);
            seen[p.port]++;
        }
        assert(seen[10] == 1 && seen[20] == 1 && seen[30] == 1);
    }

    // ── Empty input → empty ranking (no crash). ─────────────────────────────
    {
        std::map<int, std::string> empty;
        assert(rank_for_eviction(empty).empty());
    }

    std::cout << "\xE2\x9C\x85 test_kv_layer_entropy: all assertions passed\n";
    return 0;
}
