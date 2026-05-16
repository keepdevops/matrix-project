#pragma once

#include "agent.h"
#include "coordinator_context.h"
#include "httplib.h"

#include <string>
#include <vector>

std::vector<Agent> filter_agents_for_mode(CoordinatorState& st, const std::string& mode_name);

void register_coordinator_routes_core(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_modes(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_health_agents(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_agents_meta(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_presets(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_dispatch(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_architect_stream(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_misc(httplib::Server& svr, CoordinatorState& st);
void register_coordinator_routes_rag_health(httplib::Server& svr, CoordinatorState& st);

// Defined in coordinator_routes_modes_put.cpp — handles PUT /api/modes/<name>/agents
void handle_mode_agents_put(CoordinatorState& st,
                             const std::string& mode_name,
                             const httplib::Request& req,
                             httplib::Response& res);
