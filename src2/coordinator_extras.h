#pragma once

#include "httplib.h"
#include "agent.h"

#include <string>
#include <vector>

// Register the extras routes onto `svr`:
//   PUT  /api/agents/:name/prompt
//   PUT  /api/agents/:name/description
//   PUT  /api/agents/:name/tokens
//   GET  /api/health/agents
//   GET  /api/modes/:name/agents
//   PUT  /api/modes/:name/agents
//   GET  /api/presets
//   PUT  /api/presets/:name
//   DELETE /api/presets/:name
//   POST /api/presets/:name/apply
//
// `agents` is mutated in-place for token edits; `config_path` is used to derive
// sibling storage files (presets.json, mode-rosters.json) and to persist
// agent edits back into the source swarm-config.json on next save.
void register_extras_routes(httplib::Server& svr,
                            std::vector<Agent>& agents,
                            const std::string& config_path);
