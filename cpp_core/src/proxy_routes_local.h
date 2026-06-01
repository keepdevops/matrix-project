#pragma once

#include "httplib.h"

#include <string>

void register_proxy_routes_local(httplib::Server& svr, const std::string& proj_root);
void register_proxy_coordinator_forward(httplib::Server& svr);
