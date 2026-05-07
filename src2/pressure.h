#pragma once

#include "httplib.h"
#include "agent.h"
#include <vector>

void register_pressure_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents);

// Targeted per-slot KV eviction. Unlike /api/clear-cache (which erases every
// slot on every server), this endpoint only erases idle slots on servers
// whose KV usage is over a threshold, preserving warm caches that are still
// actively in use.
void register_eviction_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents);
