#pragma once
// GET /api/metrics — Prometheus text-format export of token ledger state.
// Included inline by coordinator_routes.cpp (or equivalent registration file).

#include "coordinator_context.h"
#include "token_ledger.h"
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

        res.set_content(out.str(), "text/plain; version=0.0.4; charset=utf-8");
    });
}
