#include "pipeline_order.h"
#include "../mode_module.h"

#include <iostream>
#include <unordered_set>

namespace pipeline_order {

ResolvedOrder resolve_effective_order(const ModeContext& ctx,
                                      const std::string& synth_name_for_filter) {
    ResolvedOrder result;
    const std::string preset = mode_module::option_string(ctx.mode_config, "preset", "");

    if (ctx.mode_config.contains("order") && ctx.mode_config["order"].is_array()
        && !ctx.mode_config["order"].empty()) {
        for (const auto& item : ctx.mode_config["order"]) {
            if (item.is_string()) result.order.push_back(item.get<std::string>());
        }
    }
    if (result.order.empty()
        && ctx.mode_config.contains("agents")
        && ctx.mode_config["agents"].is_array()
        && !ctx.mode_config["agents"].empty()) {
        for (const auto& item : ctx.mode_config["agents"]) {
            if (!item.is_string()) continue;
            const std::string name = item.get<std::string>();
            if (name == synth_name_for_filter) continue;
            result.order.push_back(name);
        }
    }
    if (result.order.empty() && !preset.empty()) {
        result.order = mode_module::pipeline_preset_order(preset, ctx.agents);
    }
    if (result.order.empty()) {
        std::unordered_set<std::string> emitted;
        const std::vector<std::string> tag_order =
            {"planning", "coding", "review", "data", "synthesis"};
        for (const auto& tag : tag_order) {
            for (const auto& name : mode_module::agents_with_tag(ctx.agents, tag)) {
                if (name == synth_name_for_filter) continue;
                if (emitted.insert(name).second) result.order.push_back(name);
            }
        }
        for (const auto& a : ctx.agents) {
            if (a.name == synth_name_for_filter) continue;
            if (emitted.insert(a.name).second) result.order.push_back(a.name);
        }
        result.fallback_order_used = true;
        std::cerr << "⚠️  [pipeline] roster-driven fallback: " << result.order.size()
                  << " active agent(s) chained" << std::endl;
    }

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::vector<std::string> resolved_order;
    std::unordered_set<std::string> already_in_order(result.order.begin(), result.order.end());
    std::unordered_set<std::string> seen_resolved;
    for (const auto& name : result.order) {
        if (by_name.count(name)) {
            if (seen_resolved.insert(name).second) resolved_order.push_back(name);
            continue;
        }
        std::vector<std::string> missing_tags;
        for (const auto& a : ctx.agents)
            if (a.name == name) { missing_tags = a.tags; break; }
        std::string sub;
        for (const auto& tag : missing_tags) {
            for (const auto& cand : mode_module::agents_with_tag(ctx.agents, tag)) {
                if (by_name.count(cand) && !already_in_order.count(cand)) {
                    sub = cand; break;
                }
            }
            if (!sub.empty()) break;
        }
        if (!sub.empty()) {
            result.substitutions[name] = sub;
            already_in_order.insert(sub);
            if (seen_resolved.insert(sub).second) resolved_order.push_back(sub);
            std::cerr << "⚠️  [pipeline] substituting missing '" << name
                      << "' with active '" << sub << "'" << std::endl;
        }
    }
    result.order.swap(resolved_order);
    return result;
}

}  // namespace pipeline_order
