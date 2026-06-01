#pragma once
#include "json.hpp"
#include <string>
#include <vector>

using json = nlohmann::json;

struct PortState {
    int port        = 0;
    int n_ctx       = 0;
    int total_slots = 0;
    long kv_used    = 0;
    double usage    = -1.0;
    std::vector<std::tuple<int, long, bool>> slots;
    bool ok         = false;
    std::string error;
};

PortState read_port_state(int port);

json evict_port(int port, double threshold, long min_kv_tokens,
                bool force, bool dry_run);
