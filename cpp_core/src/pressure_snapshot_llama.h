#pragma once

#include "json.hpp"

#include <string>
#include <vector>

struct PortInfo {
    int port;
    std::vector<std::string> names;
    int draft_max = 0;
};

double pressure_parse_metric(const std::string& body, const std::string& key);

nlohmann::json pressure_query_llama_port(const PortInfo& info);

nlohmann::json pressure_mlx_entry(const PortInfo& info);
