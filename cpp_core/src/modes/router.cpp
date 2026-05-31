#include "mode.h"
#include "router_classifier.h"
#include "router_dispatch.h"
#include "router_endpoint.h"
#include "router_plan_parse.h"
#include "../agent_client.h"
#include "../agent_stream.h"
#include "../mode_module.h"

#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

json run_router(const ModeContext& ctx) {
    const auto& cfg = ctx.mode_config;
    json meta = mode_module::module_meta("router", cfg);
    const std::string classifier_policy = mode_module::option_string(
        cfg, "classifier_policy", "standard");
    meta["classifier_policy"] = classifier_policy;

    json excluded_unreachable = json::array();
    std::vector<Agent> reachable_agents =
        router_endpoint::filter_reachable(ctx.agents, excluded_unreachable);
    if (!excluded_unreachable.empty()) {
        meta["excluded_unreachable"] = excluded_unreachable;
    }
    if (reachable_agents.empty()) {
        meta["error"] = "no reachable agents";
        return json{
            {"mode", "router"},
            {"agents", json::object()},
            {"final", nullptr},
            {"meta", meta}
        };
    }
    std::vector<Agent>& agents = reachable_agents;

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : agents) by_name[a.name] = &a;

    if (ctx.quality_pass) {
        json agent_outputs = json::object();
        const std::string& target = ctx.quality_pass_target;
        if (by_name.count(target)) {
            std::cout << "🧭 [router] quality_pass: skipping classifier, re-running '"
                      << target << "'" << std::endl;
            const Agent* agent = by_name[target];
            agent_outputs[target] = call_agent(*agent, ctx.prompt_for(target));
        } else {
            std::cerr << "⚠️  [router] quality_pass target '" << target
                      << "' not reachable — no agents called" << std::endl;
        }
        meta["quality_pass_target"] = target;
        meta["selected"] = json::array({target});
        return json{
            {"mode", "router"},
            {"agents", agent_outputs},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::string classifier_name = cfg.value("classifier", std::string(""));
    const std::string configured_classifier = classifier_name;
    int max_select = cfg.value("max_select", 3);
    std::vector<std::string> fallback = cfg.contains("fallback")
        ? router_plan::as_string_vec(cfg["fallback"]) : std::vector<std::string>{};

    bool fallback_classifier_used = false;
    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        classifier_name = router_classifier::choose_classifier(agents);
        fallback_classifier_used = true;
    }

    std::vector<std::string> choices = cfg.contains("choices")
        ? router_plan::as_string_vec(cfg["choices"]) : std::vector<std::string>{};
    if (choices.empty()) {
        for (const auto& a : agents) {
            if (a.name != classifier_name) choices.push_back(a.name);
        }
    } else {
        std::vector<std::string> active_choices;
        for (const auto& n : choices) {
            if (by_name.count(n)) active_choices.push_back(n);
        }
        choices.swap(active_choices);
    }
    std::unordered_set<std::string> choice_set(choices.begin(), choices.end());

    if (classifier_name.empty() || by_name.find(classifier_name) == by_name.end()) {
        std::cerr << "❌ [router] no active agents available for classifier" << std::endl;
        meta["error"] = "classifier not available";
        meta["classifier"] = classifier_name;
        return json{
            {"mode", "router"},
            {"agents", json::object()},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    if (fallback.empty()) {
        for (const auto& a : agents) {
            if (a.name == classifier_name) continue;
            fallback.push_back(a.name);
            if ((int)fallback.size() >= max_select) break;
        }
    }

    std::cout << "🧭 [router] classifier=" << classifier_name
              << " choices=" << choices.size()
              << " max_select=" << max_select << std::endl;

    auto prompt = router_classifier::build_classifier_prompt(
        choices, by_name, agents, ctx.user_prompt, max_select, classifier_policy);
    if (!prompt.load_csv.empty()) meta["load_hint"] = prompt.load_csv;

    router_dispatch::StreamState st;
    auto on_chunk = router_dispatch::make_on_chunk(
        st, agents, by_name, meta, choice_set, max_select, ctx);

    agent_stream::stream_agent(*by_name[classifier_name],
                               prompt.system, prompt.user,
                               on_chunk, /*cancel=*/nullptr);

    if (!st.agents_launched) {
        st.agents_launched = true;
        router_dispatch::apply_directives_and_dispatch(
            st, agents, by_name, meta, choice_set, max_select, ctx);
    }

    router_dispatch::apply_fallback_selection(
        st, agents, by_name, fallback, classifier_name, max_select, ctx);

    std::cout << "🧭 [router] selected=[";
    for (size_t i = 0; i < st.selected.size(); ++i)
        std::cout << (i ? ", " : "") << st.selected[i];
    std::cout << "] fallback=" << (st.fallback_used ? "yes" : "no") << std::endl;

    json agent_outputs = router_dispatch::collect_agent_outputs(st, meta);

    meta["classifier"] = classifier_name;
    if (!configured_classifier.empty()) meta["configured_classifier"] = configured_classifier;
    meta["selected"] = st.selected;
    meta["classifier_raw"] = st.raw;
    meta["fallback_used"] = st.fallback_used;
    meta["fallback_classifier_used"] = fallback_classifier_used;
    if (!st.affinity_meta.empty()) meta["kv_affinity"] = st.affinity_meta;

    return json{
        {"mode", "router"},
        {"agents", agent_outputs},
        {"final", nullptr},
        {"meta", meta}
    };
}

struct Register {
    Register() {
        modes::register_mode({
            "router",
            "Classifier agent picks a subset; prompt is broadcast to those agents only.",
            run_router
        });
    }
} _reg;

} // namespace
