#pragma once
// Inline token-budget route — included by coordinator_routes.cpp.

#include "coordinator_routes_includes.h"
#include "coordinator_context.h"
#include "token_ledger.h"

namespace token_budget_routes {

inline void register_routes(httplib::Server& svr, CoordinatorState&) {
    svr.Get(R"(/api/token-budget/([^/]+))",
            [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string session_id = req.matches[1];
        res.set_content(token_ledger::snapshot(session_id).dump(), "application/json");
    });

    svr.Delete(R"(/api/token-budget/([^/]+))",
               [](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string session_id = req.matches[1];
        token_ledger::reset(session_id);
        res.set_content("{\"reset\":true}", "application/json");
    });
}

} // namespace token_budget_routes
