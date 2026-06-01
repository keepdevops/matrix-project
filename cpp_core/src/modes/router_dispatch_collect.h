#pragma once
#include "router_dispatch.h"
#include "../agent_client.h"
#include "../kv_router.h"
#include <iostream>
#include <future>
#include <unordered_set>

namespace router_dispatch_collect {

inline void launch_agents(
    router_dispatch::StreamState& st,
    const std::unordered_map<std::string, const Agent*>& by_name,
    const ModeContext& ctx) {
    for (const auto& name : st.selected) {
        Agent agent_copy = *by_name.at(name);
        std::string prompt = ctx.prompt_for(name);
        st.agent_futures.push_back(std::async(std::launch::async,
            [agent_copy, prompt]() mutable {
                return std::make_pair(agent_copy.name, call_agent(agent_copy, prompt));
            }));
    }
}

inline void apply_fallback_selection(
    router_dispatch::StreamState& st,
    std::vector<Agent>& agents,
    const std::unordered_map<std::string, const Agent*>& by_name,
    const std::vector<std::string>& fallback,
    const std::string& classifier_name,
    int max_select,
    const ModeContext& ctx) {
    if (!st.selected.empty()) return;
    st.fallback_used = true;
    std::cerr << "⚠️  [router] no valid selection; using fallback" << std::endl;
    std::vector<std::string> ranked = fallback;
    if (ranked.size() > 1)
        kv_router::rank_by_affinity(ranked, ctx.user_prompt, /*min_bytes=*/64);
    std::unordered_set<std::string> seen;
    for (const auto& name : ranked) {
        if (!by_name.count(name)) continue;
        if (seen.insert(name).second) st.selected.push_back(name);
        if ((int)st.selected.size() >= max_select) break;
    }
    if (st.selected.empty()) {
        for (const auto& a : agents) {
            if (a.name == classifier_name) continue;
            if (seen.insert(a.name).second) st.selected.push_back(a.name);
            if ((int)st.selected.size() >= max_select) break;
        }
    }
    launch_agents(st, by_name, ctx);
}

inline nlohmann::json collect_agent_outputs(router_dispatch::StreamState& st, nlohmann::json& meta) {
    nlohmann::json agent_outputs = nlohmann::json::object();
    if (!st.agent_futures.empty()) {
        for (auto& fut : st.agent_futures) {
            auto pr = fut.get();
            agent_outputs[pr.first] = pr.second;
        }
    } else {
        std::cerr << "❌ [router] no agents selected and no valid fallback" << std::endl;
        meta["error"] = "no agents selected and fallback empty/invalid";
    }
    return agent_outputs;
}

}  // namespace router_dispatch_collect
