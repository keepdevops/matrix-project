#include "mode.h"
#include "router_setup.h"
#include "router_classifier.h"
#include "router_dispatch.h"
#include "router_endpoint.h"

#include "../agent_stream.h"
#include "../mode_module.h"

#include <iostream>
#include <string>

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
    if (!excluded_unreachable.empty())
        meta["excluded_unreachable"] = excluded_unreachable;
    if (reachable_agents.empty()) {
        meta["error"] = "no reachable agents";
        return json{{"mode","router"},{"agents",json::object()},{"final",nullptr},{"meta",meta}};
    }
    std::vector<Agent>& agents = reachable_agents;

    router_setup::AgentMap by_name;
    for (const auto& a : agents) by_name[a.name] = &a;

    // Quality-pass shortcut: re-run a single target without classifier.
    if (ctx.quality_pass) {
        json result = router_setup::handle_quality_pass(ctx, by_name, meta);
        if (!result.empty()) return result;
    }

    auto cc = router_setup::resolve_classifier_context(cfg, agents, by_name, meta);
    if (cc.error) {
        return json{{"mode","router"},{"agents",json::object()},{"final",nullptr},{"meta",meta}};
    }

    std::cout << "🧭 [router] classifier=" << cc.classifier_name
              << " choices=" << cc.choices.size()
              << " max_select=" << cc.max_select << std::endl;

    auto prompt = router_classifier::build_classifier_prompt(
        cc.choices, by_name, agents, ctx.user_prompt, cc.max_select, classifier_policy);
    if (!prompt.load_csv.empty()) meta["load_hint"] = prompt.load_csv;

    router_dispatch::StreamState st;
    auto on_chunk = router_dispatch::make_on_chunk(
        st, agents, by_name, meta, cc.choice_set, cc.max_select, ctx);

    agent_stream::stream_agent(*by_name[cc.classifier_name],
                               prompt.system, prompt.user,
                               on_chunk, /*cancel=*/nullptr);

    if (!st.agents_launched) {
        st.agents_launched = true;
        router_dispatch::apply_directives_and_dispatch(
            st, agents, by_name, meta, cc.choice_set, cc.max_select, ctx);
    }

    router_dispatch::apply_fallback_selection(
        st, agents, by_name, cc.fallback, cc.classifier_name, cc.max_select, ctx);

    std::cout << "🧭 [router] selected=[";
    for (size_t i = 0; i < st.selected.size(); ++i)
        std::cout << (i ? ", " : "") << st.selected[i];
    std::cout << "] fallback=" << (st.fallback_used ? "yes" : "no") << std::endl;

    json agent_outputs = router_dispatch::collect_agent_outputs(st, meta);

    meta["classifier"] = cc.classifier_name;
    if (!cc.configured_classifier.empty()) meta["configured_classifier"] = cc.configured_classifier;
    meta["selected"] = st.selected;
    meta["classifier_raw"] = st.raw;
    meta["fallback_used"] = st.fallback_used;
    meta["fallback_classifier_used"] = cc.fallback_classifier_used;
    if (!st.affinity_meta.empty()) meta["kv_affinity"] = st.affinity_meta;

    return json{{"mode","router"},{"agents",agent_outputs},{"final",nullptr},{"meta",meta}};
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
