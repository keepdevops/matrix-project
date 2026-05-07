#pragma once

#include "httplib.h"
#include "agent.h"
#include <vector>

void register_pressure_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents);
