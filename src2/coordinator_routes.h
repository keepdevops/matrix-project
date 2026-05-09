#pragma once

#include "coordinator_context.h"
#include "httplib.h"

void register_coordinator_routes(httplib::Server& svr, CoordinatorState& st);
