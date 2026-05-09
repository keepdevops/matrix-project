#pragma once

#include "httplib.h"

#include <string>

/// Register Matrix proxy HTTP surface (httplib-bound); I/O helpers live in proxy_* without httplib.
void register_proxy_routes(httplib::Server& svr, const std::string& proj_root);
