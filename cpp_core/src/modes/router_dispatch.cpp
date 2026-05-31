#include "router_dispatch.h"
#include "router_plan_parse.h"
#include "../agent_client.h"
#include "../kv_router.h"

#include <future>
#include <iostream>
#include <unordered_set>

namespace router_dispatch {

void apply_directives_and_dispatch(
    StreamState& st,
    std::vector<Agent>& agents,
    std::unordered_map<std::string, const Agent*>& by_name,
    nlohmann::json& meta,
    const std::unordered_set<std::string>& choice_set,
    int max_select,
    const ModeContext& ctx) {
    auto directives = router_plan::parse_set_tokens_directives(st.raw);
    if (!directives.empty()) {
        int n = router_plan::apply_token_directives(agents, directives);
        nlohmann::json token_adjustments = nlohmann::json::array();
        for (const auto& d : directives) {
            nlohmann::json entry = {{"agent", d.agent}};
            if (d.max_tokens > 0)        entry["max_tokens"]        = d.max_tokens;
            if (d.read_timeout_secs > 0) entry["read_timeout_secs"] = d.read_timeout_secs;
            token_adjustments.push_back(entry);
            std::cout << "🔧 [router] foreman SET_TOKENS: " << d.agent;
            if (d.max_tokens > 0) std::cout << " max_tokens=" << d.max_tokens;
            if (d.read_timeout_secs > 0) std::cout << " read_timeout_secs=" << d.read_timeout_secs;
            std::cout << std::endl;
        }
        if (n > 0) {
            meta["token_adjustments"] = token_adjustments;
            by_name.clear();
            for (const auto& a : agents) by_name[a.name] = &a;
        }
    }

    std::vector<std::string> parsed =
        router_plan::extract_names_from_plan(st.raw, choice_set);
    if (parsed.size() > 1) {
        for (const auto& n : parsed)
            st.affinity_meta[n] = (uint64_t)kv_router::affinity(n, ctx.user_prompt);
        kv_router::rank_by_affinity(parsed, ctx.user_prompt, /*min_bytes=*/64);
    }

    std::unordered_set<std::string> seen;
    for (const auto& name : parsed) {
        if (!choice_set.count(name) || !by_name.count(name)) continue;
        if (seen.insert(name).second) st.selected.push_back(name);
        if ((int)st.selected.size() >= max_select) break;
    }

    for (const auto& name : st.selected) {
        Agent agent_copy = *by_name.at(name);
        std::string prompt = ctx.prompt_for(name);
        st.agent_futures.push_back(std::async(std::launch::async,
            [agent_copy, prompt]() mutable {
                return std::make_pair(agent_copy.name, call_agent(agent_copy, prompt));
            }));
    }
}

std::function<void(const std::string&)> make_on_chunk(
    StreamState& st,
    std::vector<Agent>& agents,
    std::unordered_map<std::string, const Agent*>& by_name,
    nlohmann::json& meta,
    const std::unordered_set<std::string>& choice_set,
    int max_select,
    const ModeContext& ctx) {
    return [&](const std::string& delta) {
        st.raw += delta;
        if (st.agents_launched) return;
        if (st.raw.find("SELECTED:") == std::string::npos) return;
        if (st.raw.find('\n', st.raw.find("SELECTED:")) == std::string::npos) return;
        st.agents_launched = true;
        apply_directives_and_dispatch(st, agents, by_name, meta, choice_set, max_select, ctx);
        if (!st.selected.empty())
            std::cout << "⚡ [router] early dispatch " << st.agent_futures.size()
                      << " agent(s) while classifier finishes" << std::endl;
    };
}

void apply_fallback_selection(
    StreamState& st,
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
    for (const auto& name : st.selected) {
        Agent agent_copy = *by_name.at(name);
        std::string prompt = ctx.prompt_for(name);
        st.agent_futures.push_back(std::async(std::launch::async,
            [agent_copy, prompt]() mutable {
                return std::make_pair(agent_copy.name, call_agent(agent_copy, prompt));
            }));
    }
}

nlohmann::json collect_agent_outputs(StreamState& st, nlohmann::json& meta) {
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

}  // namespace router_dispatch
