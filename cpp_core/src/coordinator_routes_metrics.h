#pragma once
// GET /api/metrics — Prometheus text-format export of token ledger state.
// Included inline by coordinator_routes.cpp (or equivalent registration file).

#include "coordinator_context.h"
#include "token_ledger.h"
#include "agent_health.h"
#include "httplib.h"
#include <sstream>
#include <string>

inline void register_coordinator_routes_metrics(httplib::Server& svr, CoordinatorState& /*st*/) {
    svr.Get("/api/metrics", [](const httplib::Request& /*req*/, httplib::Response& res) {
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

        res.set_content(out.str(), "text/plain; version=0.0.4; charset=utf-8");
    });

    // JSON version of session snapshots — used by TokenBudgetDashboard
    svr.Get("/api/metrics-json", [](const httplib::Request& /*req*/, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(token_ledger::all_sessions_snapshot().dump(), "application/json");
    });
}
