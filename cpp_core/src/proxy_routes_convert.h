#pragma once
#include "httplib.h"
#include <string>

void register_convert_routes(httplib::Server& svr, const std::string& proj_root);
