#pragma once

#include "proxy_configure_internal.h"

#include <map>
#include <string>
#include <vector>

std::vector<int> proxy_configure_wait_for_health(
    const std::map<int, PortGroup>& pgs, int timeout_secs);

std::string proxy_configure_check_docker_model_runner(const std::string& model);
