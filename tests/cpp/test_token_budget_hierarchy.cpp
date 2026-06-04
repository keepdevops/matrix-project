// MS-84 runtime test: resolve_budget() + load_budget_hierarchy(). The grep-test
// only checked the header *mentions* BudgetHierarchy/resolve; here the agent >
// mode > global resolution and the JSON loader actually execute.

#include "token_budget_hierarchy.h"

#include <cassert>
#include <iostream>

int main() {
    // ── resolve_budget: priority agent > mode > global, 0 = unlimited ────────
    {
        BudgetHierarchy h;
        h.global = 1000;
        h.by_mode["pipeline"] = 500;
        h.by_agent["programmer"] = 200;

        // Agent override wins over mode + global.
        assert(resolve_budget(h, "pipeline", "programmer") == 200);
        // Unknown agent → falls through to mode.
        assert(resolve_budget(h, "pipeline", "architect") == 500);
        // No agent → mode.
        assert(resolve_budget(h, "pipeline") == 500);
        // Unknown mode, no agent → global.
        assert(resolve_budget(h, "cascade") == 1000);
        // Empty mode + empty agent → global.
        assert(resolve_budget(h, "") == 1000);
    }

    // Zero entries are treated as unset and fall through (0 = unlimited).
    {
        BudgetHierarchy h;
        h.global = 800;
        h.by_mode["pipeline"] = 0;        // explicit 0 → not a real cap
        h.by_agent["programmer"] = 0;     // explicit 0 → not a real cap
        assert(resolve_budget(h, "pipeline", "programmer") == 800);  // → global
    }

    // Empty hierarchy → 0 (unlimited).
    {
        BudgetHierarchy h;
        assert(resolve_budget(h, "pipeline", "programmer") == 0);
    }

    // ── load_budget_hierarchy: scalar form ──────────────────────────────────
    {
        nlohmann::json coord = {{"token_budget", 1200}};
        BudgetHierarchy h = load_budget_hierarchy(coord);
        assert(h.global == 1200);
        assert(h.by_mode.empty() && h.by_agent.empty());
    }

    // ── load_budget_hierarchy: object form with mode + agent maps ────────────
    {
        nlohmann::json coord = {
            {"token_budget", {
                {"global", 1000},
                {"mode",  {{"pipeline", 500}, {"cascade", 700}}},
                {"agent", {{"programmer", 200}}},
            }},
        };
        BudgetHierarchy h = load_budget_hierarchy(coord);
        assert(h.global == 1000);
        assert(h.by_mode.at("pipeline") == 500);
        assert(h.by_mode.at("cascade") == 700);
        assert(h.by_agent.at("programmer") == 200);
        // End-to-end through resolve.
        assert(resolve_budget(h, "cascade", "programmer") == 200);
        assert(resolve_budget(h, "cascade") == 700);
    }

    // No token_budget key → empty hierarchy.
    {
        BudgetHierarchy h = load_budget_hierarchy(nlohmann::json::object());
        assert(h.global == 0 && h.by_mode.empty() && h.by_agent.empty());
    }

    std::cout << "\xE2\x9C\x85 test_token_budget_hierarchy: all assertions passed\n";
    return 0;
}
