#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_health_agents(httplib::Server& svr, CoordinatorState& st) {
    // 4c. Per-agent health — circuit breaker state for diagnostic / UI use
    svr.Get("/api/health/agents",
            [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(agent_health::snapshot().dump(), "application/json");
    });
}
