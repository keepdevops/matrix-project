#pragma once

#include "coordinator_routes_architect_synthesis.h"
#include "agent.h"
#include "json.hpp"

#include <atomic>
#include <map>
#include <string>
#include <vector>

void stream_parallel_agents(const std::vector<const Agent*>& parallel_agents,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs);

void run_stream_pipeline_mode(const std::vector<Agent>& agents,
                              const nlohmann::json& cfg,
                              const std::string& synth_name,
                              const Agent* synth_agent,
                              const std::string& prompt,
                              const std::string& mode,
                              std::atomic<bool>* cancel,
                              const WriteEventFn& write_event,
                              std::map<std::string, std::string>& outputs,
                              std::vector<std::string>& participants);

void run_stream_router_mode(const std::vector<Agent>& agents,
                            const nlohmann::json& cfg,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs);

void run_stream_broadcast_mode(const std::vector<Agent>& agents,
                               const std::string& synth_name,
                               const std::string& mode,
                               const Agent* synth_agent,
                               const std::string& prompt,
                               std::atomic<bool>* cancel,
                               const WriteEventFn& write_event,
                               std::map<std::string, std::string>& outputs,
                               std::vector<std::string>& participants);
