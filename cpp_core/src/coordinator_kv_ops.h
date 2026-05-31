#pragma once

#include "agent.h"
#include "json.hpp"

#include <map>
#include <string>
#include <vector>

namespace coordinator_kv_ops {

std::map<int, std::string> clear_kv_on_ports(const std::map<int, int>& port_slots);
nlohmann::json evict_slots_on_ports(const std::map<int, int>& port_slots);

std::map<int, int> agent_port_slots(const std::vector<Agent>& agents);

}  // namespace coordinator_kv_ops
