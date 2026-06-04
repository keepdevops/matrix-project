// MS-68 2c′: LCP-in-token-space correctness test.
// No Python / MLX required — validates the pure-logic pieces:
//   1. lcp_len: longest common prefix between two token sequences
//   2. delta extraction: tokens after the prefix
//   3. edge cases: identical, diverge at 0, one empty, shorter-than-min_ctx

#include <cassert>
#include <iostream>
#include <string>
#include <vector>

// Simulates the LCP loop in build_stream_setup's Python:
//   while _lcp < _nn and _cached[_lcp] == _full[_lcp]: _lcp += 1
static std::size_t lcp_len(const std::vector<int>& cached,
                            const std::vector<int>& full) {
    const std::size_t nn = std::min(cached.size(), full.size());
    std::size_t i = 0;
    while (i < nn && cached[i] == full[i]) ++i;
    return i;
}

static std::vector<int> delta(const std::vector<int>& full, std::size_t lcp) {
    return {full.begin() + static_cast<long>(lcp), full.end()};
}

int main() {
    // 1. Identical sequences → full reuse, zero delta
    {
        const std::vector<int> prev = {1, 2, 3, 4, 5};
        const std::vector<int> next = {1, 2, 3, 4, 5};
        const std::size_t lcp = lcp_len(prev, next);
        assert(lcp == 5);
        assert(delta(next, lcp).empty());
    }

    // 2. Common prefix then diverge
    {
        const std::vector<int> prev = {1, 2, 3, 4, 5};
        const std::vector<int> next = {1, 2, 3, 6, 7};
        const std::size_t lcp = lcp_len(prev, next);
        assert(lcp == 3);
        const auto d = delta(next, lcp);
        assert(d.size() == 2 && d[0] == 6 && d[1] == 7);
    }

    // 3. No common prefix → full new prompt is the delta
    {
        const std::vector<int> prev = {9, 8, 7};
        const std::vector<int> next = {1, 2, 3, 4};
        const std::size_t lcp = lcp_len(prev, next);
        assert(lcp == 0);
        const auto d = delta(next, lcp);
        assert(d == next);
    }

    // 4. New prompt extends old (multi-turn growth)
    {
        const std::vector<int> prev = {1, 2, 3};
        const std::vector<int> next = {1, 2, 3, 4, 5, 6};
        const std::size_t lcp = lcp_len(prev, next);
        assert(lcp == 3);
        const auto d = delta(next, lcp);
        assert((d == std::vector<int>{4, 5, 6}));
    }

    // 5. New prompt is shorter than old (regression / new topic)
    {
        const std::vector<int> prev = {1, 2, 3, 4, 5, 6};
        const std::vector<int> next = {1, 2, 9};
        const std::size_t lcp = lcp_len(prev, next);
        assert(lcp == 2);
        const auto d = delta(next, lcp);
        assert((d == std::vector<int>{9}));
    }

    // 6. Size gate: below min_ctx → skip cache (lcp_len still correct, gate logic external)
    {
        const std::vector<int> small = {1, 2, 3};   // < 1024 tokens → caller skips
        assert(small.size() < 1024);
        // lcp_len still works — the gate is the caller's responsibility
        const std::vector<int> prev = {1, 2, 3};
        assert(lcp_len(prev, small) == 3);
    }

    // 7. Trim semantics: after lcp-trim the cache holds `lcp` tokens.
    //    `trim_prompt_cache(cache, stale_tail)` trims the TAIL, so:
    //    stale_tail = len(cached) - lcp → cache shrinks to `lcp` entries.
    {
        const std::vector<int> prev = {1, 2, 3, 4, 5};  // 5 cached tokens
        const std::vector<int> next = {1, 2, 3, 6, 7};
        const std::size_t lcp = lcp_len(prev, next);   // 3
        const int stale_tail = static_cast<int>(prev.size()) - static_cast<int>(lcp); // 2
        assert(stale_tail == 2);  // trim_prompt_cache(cache, 2) leaves 3 tokens
    }

    std::cout << "✅ test_prompt_cache_lcp: all assertions passed\n";
    return 0;
}
