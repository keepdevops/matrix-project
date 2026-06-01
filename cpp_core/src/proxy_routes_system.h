#pragma once
#include "httplib.h"
#include <string>

void register_proxy_system_routes(httplib::Server& svr, const std::string& proj_root);
