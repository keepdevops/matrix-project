#pragma once

#include "../agent.h"
#include "../json.hpp"
#include "mode.h"

#include <functional>
#include <future>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace router_dispatch {

struct StreamState {
    std::string raw;
    bool agents_launched = false;
    bool fallback_used = false;
    nlohmann::json affinity_meta = nlohmann::json::object();
    std::vector<std::string> selected;
    std::vector<std::future<std::pair<std::string, std::string>>> agent_futures;
};

void apply_directives_and_dispatch(
    StreamState& st,
    std::vector<Agent>& agents,
    std::unordered_map<std::string, const Agent*>& by_name,
    nlohmann::json& meta,
    const std::unordered_set<std::string>& choice_set,
    int max_select,
    const ModeContext& ctx);

std::function<void(const std::string&)> make_on_chunk(
    StreamState& st,
    std::vector<Agent>& agents,
    std::unordered_map<std::string, const Agent*>& by_name,
    nlohmann::json& meta,
    const std::unordered_set<std::string>& choice_set,
    int max_select,
    const ModeContext& ctx);

void apply_fallback_selection(
    StreamState& st,
    std::vector<Agent>& agents,
    const std::unordered_map<std::string, const Agent*>& by_name,
    const std::vector<std::string>& fallback,
    const std::string& classifier_name,
    int max_select,
    const ModeContext& ctx);

nlohmann::json collect_agent_outputs(StreamState& st, nlohmann::json& meta);

}  // namespace router_dispatch
