#pragma once

#include "httplib.h"
#include "json.hpp"
#include "agent.h"
#include <vector>

void register_pressure_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents);

// Same payload as GET /api/pressure but callable in-process. Used by
// pressure-aware routing to enrich the classifier prompt with current load.
// Result is a JSON array of per-port entries, each containing at minimum
// `port`, `names`, `usage` (0..1).
nlohmann::json snapshot_pressure(const std::vector<Agent>& agents);

// Targeted per-slot KV eviction. Unlike /api/clear-cache (which erases every
// slot on every server), this endpoint only erases idle slots on servers
// whose KV usage is over a threshold, preserving warm caches that are still
// actively in use.
void register_eviction_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents);
