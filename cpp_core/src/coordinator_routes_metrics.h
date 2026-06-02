#pragma once
// GET /api/metrics — Prometheus text-format export of token ledger state.
// Included inline by coordinator_routes.cpp (or equivalent registration file).

#include "coordinator_context.h"
#include "token_ledger.h"
#include "agent_health.h"
#include "response_cache.h"
#include "httplib.h"
#include <sstream>
#include <string>

inline void register_coordinator_routes_metrics(httplib::Server& svr, CoordinatorState& st) {
    svr.Get("/api/metrics", [&st](const httplib::Request& /*req*/, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        auto sessions = token_ledger::all_sessions_snapshot();

        std::ostringstream out;
        out << "# HELP matrix_token_consumed_total Tokens consumed by session\n"
            << "# TYPE matrix_token_consumed_total gauge\n";
        for (const auto& s : sessions) {
            std::string sid = s.value("session_id", "");
            out << "matrix_token_consumed_total{session=\"" << sid << "\"} "
                << s.value("consumed", 0) << "\n";
        }

        out << "# HELP matrix_token_budget_remaining Tokens remaining in session budget (-1 = unlimited)\n"
            << "# TYPE matrix_token_budget_remaining gauge\n";
        for (const auto& s : sessions) {
            std::string sid = s.value("session_id", "");
            out << "matrix_token_budget_remaining{session=\"" << sid << "\"} "
                << s.value("remaining", -1) << "\n";
        }

        out << "# HELP matrix_token_overrun Whether the session budget is overrun (0/1)\n"
            << "# TYPE matrix_token_overrun gauge\n";
        for (const auto& s : sessions) {
            std::string sid = s.value("session_id", "");
            out << "matrix_token_overrun{session=\"" << sid << "\"} "
                << (s.value("overrun", false) ? 1 : 0) << "\n";
        }

        // Circuit breaker metrics
        auto health = agent_health::snapshot();
        out << "# HELP matrix_agent_breaker_open Circuit breaker open (1) or closed (0)\n"
            << "# TYPE matrix_agent_breaker_open gauge\n";
        for (const auto& [name, val] : health.items())
            out << "matrix_agent_breaker_open{agent=\"" << name << "\"} "
                << (val.value("tripped", false) ? 1 : 0) << "\n";

        out << "# HELP matrix_agent_breaker_failures Recent failures in sliding window\n"
            << "# TYPE matrix_agent_breaker_failures gauge\n";
        for (const auto& [name, val] : health.items())
            out << "matrix_agent_breaker_failures{agent=\"" << name << "\"} "
                << val.value("recent_failures", 0) << "\n";

        out << "# HELP matrix_agent_breaker_cooldown_ms Cooldown remaining in ms\n"
            << "# TYPE matrix_agent_breaker_cooldown_ms gauge\n";
        for (const auto& [name, val] : health.items())
            out << "matrix_agent_breaker_cooldown_ms{agent=\"" << name << "\"} "
                << val.value("cooldown_remaining_ms", 0) << "\n";

        // Response cache metrics
        {
            auto cs = response_cache::stats();
            out << "# HELP matrix_cache_hits_total Response cache hits since startup\n"
                << "# TYPE matrix_cache_hits_total counter\n"
                << "matrix_cache_hits_total " << cs.hits << "\n"
                << "# HELP matrix_cache_misses_total Response cache misses since startup\n"
                << "# TYPE matrix_cache_misses_total counter\n"
                << "matrix_cache_misses_total " << cs.misses << "\n"
                << "# HELP matrix_cache_size Current cached entries\n"
                << "# TYPE matrix_cache_size gauge\n"
                << "matrix_cache_size " << cs.size << "\n"
                << "# HELP matrix_cache_evictions_total LRU evictions since startup\n"
                << "# TYPE matrix_cache_evictions_total counter\n"
                << "matrix_cache_evictions_total " << cs.evictions << "\n";
        }

        // Speculative decoding config (static — from agent config, not live)
        out << "# HELP matrix_agent_draft_max Speculative draft tokens configured (0 = disabled)\n"
            << "# TYPE matrix_agent_draft_max gauge\n";
        for (const auto& a : st.agents)
            out << "matrix_agent_draft_max{agent=\"" << a.name << "\"} "
                << a.draft_max << "\n";

        res.set_content(out.str(), "text/plain; version=0.0.4; charset=utf-8");
    });

    // JSON version of session snapshots — used by TokenBudgetDashboard
    svr.Get("/api/metrics-json", [](const httplib::Request& /*req*/, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(token_ledger::all_sessions_snapshot().dump(), "application/json");
    });
}
