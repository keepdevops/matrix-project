#include "coordinator_routes.h"
#include "coordinator_routes_internal.h"
#ifdef MATRIX_MLX_NATIVE_COORD
#include "coordinator_routes_mlx.h"
#endif
#include "coordinator_routes_token_budget.h"
#include "coordinator_routes_metrics.h"
#include "coordinator_routes_history_search.h"
#include "coordinator_routes_history_fork.h"
#include "coordinator_routes_history_diff.h"
#include "coordinator_routes_session_export.h"
#include "coordinator_routes_templates.h"
#include "coordinator_routes_annotations.h"
#include "coordinator_routes_rag_trajectory.h"
#include "coordinator_routes_supervisor.h"
#include "coordinator_routes_simulate.h"
#include "coordinator_routes_negotiate.h"
#include "coordinator_routes_push.h"
#include "coordinator_routes_rss.h"

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
    register_coordinator_routes_metrics(svr, st);
    register_coordinator_routes_history_search(svr, st);
    register_coordinator_routes_history_fork(svr, st);
    register_coordinator_routes_history_diff(svr, st);
    register_coordinator_routes_session_export(svr, st);
    register_coordinator_routes_templates(svr, st);
    register_coordinator_routes_annotations(svr, st);
    register_coordinator_routes_rag_trajectory(svr, st);
    register_coordinator_routes_supervisor(svr, st);
    register_coordinator_routes_simulate(svr, st);
    register_coordinator_routes_negotiate(svr, st);
    register_coordinator_routes_push(svr, st);
    rss_routes::register_routes(svr);
#ifdef MATRIX_MLX_NATIVE_COORD
    register_coordinator_routes_mlx(svr, st);
#endif
}
