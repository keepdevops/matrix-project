#pragma once
// Inline helpers for router quality-pass shortcut and classifier/choices setup.
// Included only by router.cpp.

#include "mode.h"
#include "router_classifier.h"
#include "router_plan_parse.h"
#include "../agent_client.h"
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace router_setup {

using json = nlohmann::json;
using AgentMap = std::unordered_map<std::string, const Agent*>;

// Returns a fully-populated quality-pass result, or null json{} if not a quality pass.
inline json handle_quality_pass(
    const ModeContext& ctx,
    const AgentMap& by_name,
    json& meta
) {
    if (!ctx.quality_pass) return json{};
    const std::string& target = ctx.quality_pass_target;
    json agent_outputs = json::object();
    if (by_name.count(target)) {
        std::cout << "🧭 [router] quality_pass: skipping classifier, re-running '"
                  << target << "'" << std::endl;
        agent_outputs[target] = call_agent(*by_name.at(target), ctx.prompt_for(target));
    } else {
        std::cerr << "⚠️  [router] quality_pass target '" << target
                  << "' not reachable — no agents called" << std::endl;
    }
    meta["quality_pass_target"] = target;
    meta["selected"] = json::array({target});
    return json{{"mode","router"},{"agents",agent_outputs},{"final",nullptr},{"meta",meta}};
}

struct ClassifierContext {
    std::string classifier_name;
    std::string configured_classifier;
    int max_select;
    std::vector<std::string> fallback;
    std::vector<std::string> choices;
    std::unordered_set<std::string> choice_set;
    bool fallback_classifier_used = false;
    bool error = false;
};

inline ClassifierContext resolve_classifier_context(
    const json& cfg,
    const std::vector<Agent>& agents,
    const AgentMap& by_name,
    json& meta
) {
    ClassifierContext c;
    c.classifier_name = cfg.value("classifier", std::string(""));
    c.configured_classifier = c.classifier_name;
    c.max_select = cfg.value("max_select", 3);
    c.fallback = cfg.contains("fallback")
        ? router_plan::as_string_vec(cfg["fallback"]) : std::vector<std::string>{};

    if (c.classifier_name.empty() || by_name.find(c.classifier_name) == by_name.end()) {
        c.classifier_name = router_classifier::choose_classifier(agents);
        c.fallback_classifier_used = true;
    }

    c.choices = cfg.contains("choices")
        ? router_plan::as_string_vec(cfg["choices"]) : std::vector<std::string>{};
    if (c.choices.empty()) {
        for (const auto& a : agents)
            if (a.name != c.classifier_name) c.choices.push_back(a.name);
    } else {
        std::vector<std::string> active;
        for (const auto& n : c.choices)
            if (by_name.count(n)) active.push_back(n);
        c.choices.swap(active);
    }
    c.choice_set = std::unordered_set<std::string>(c.choices.begin(), c.choices.end());

    if (c.classifier_name.empty() || by_name.find(c.classifier_name) == by_name.end()) {
        std::cerr << "❌ [router] no active agents available for classifier" << std::endl;
        meta["error"] = "classifier not available";
        meta["classifier"] = c.classifier_name;
        c.error = true;
        return c;
    }

    if (c.fallback.empty()) {
        for (const auto& a : agents) {
            if (a.name == c.classifier_name) continue;
            c.fallback.push_back(a.name);
            if ((int)c.fallback.size() >= c.max_select) break;
        }
    }
    return c;
}

} // namespace router_setup
