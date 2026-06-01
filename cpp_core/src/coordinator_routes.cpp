#include "coordinator_routes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_token_budget.h"

void register_coordinator_routes(httplib::Server& svr, CoordinatorState& st) {
    register_coordinator_routes_core(svr, st);
    register_coordinator_routes_modes(svr, st);
    register_coordinator_routes_health_agents(svr, st);
    register_coordinator_routes_agents_meta(svr, st);
    register_coordinator_routes_presets(svr, st);
    register_coordinator_routes_dispatch(svr, st);
    register_coordinator_routes_architect_stream(svr, st);
    register_coordinator_routes_misc(svr, st);
    register_coordinator_routes_rag_health(svr, st);
    token_budget_routes::register_routes(svr, st);
}
