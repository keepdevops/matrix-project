#include "mode.h"
#include "../agent_client.h"
#include "../mode_module.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"

#include <future>
#include <iostream>
#include <string>
#include <utility>

using json = nlohmann::json;

namespace {

// Cascade: parallel broadcast (like flat) followed by an optional synthesis
// reducer (like the pipeline synthesizer). The result is a "mixture-of-agents"
// pattern — every roster member contributes in parallel, then a designated
// reducer agent merges their answers into one consolidated final response.
//
// mode_config schema:
//   { "synthesizer": "<agent name>" }   // optional; required for `final` to be non-null
//
// If no synthesizer is set OR it isn't active, cascade degrades to flat-mode
// semantics (per-agent outputs, final=null) rather than failing — so the mode
// is always usable even before a reducer is configured.
json run_cascade(const ModeContext& ctx) {
    std::cout << "🌊 [cascade] broadcasting to " << ctx.agents.size()
              << " agent(s) in parallel..." << std::endl;

    std::string synthesizer_name;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string()) {
        synthesizer_name = ctx.mode_config["synthesizer"].get<std::string>();
    }

    // Broadcast to every agent except the synthesizer (the synthesizer is the
    // reducer, not a parallel responder — having it answer twice would
    // contaminate its own input on the second pass).
    // On quality_pass, further narrow to only the target agent so corrective
    // inference is focused; the synthesizer still runs after to merge outputs.
    json agent_outputs = json::object();
    json meta = mode_module::module_meta("cascade", ctx.mode_config);
    const std::string synthesis_policy = mode_module::option_string(
        ctx.mode_config, "synthesis_policy", "summary");
    meta["synthesis_policy"] = synthesis_policy;
    std::vector<std::future<std::pair<std::string, std::string>>> futures;
    std::vector<std::string> participants;
    bool qp_target_found = false;
    for (const auto& a : ctx.agents) {
        if (a.name == synthesizer_name) continue;
        if (ctx.quality_pass && a.name != ctx.quality_pass_target) {
            std::cout << "⏭️  [cascade] quality_pass: skipping '" << a.name << "'" << std::endl;
            continue;
        }
        if (ctx.quality_pass) qp_target_found = true;
        participants.push_back(a.name);
        const std::string prompt = ctx.user_prompt;
        const Agent agent = a;
        futures.push_back(std::async(std::launch::async, [prompt, agent]() {
            return std::make_pair(agent.name, call_agent(agent, prompt));
        }));
    }
    if (ctx.quality_pass && !qp_target_found) {
        std::cerr << "⚠️  [cascade] quality_pass target '" << ctx.quality_pass_target
                  << "' not in roster — no agents called" << std::endl;
    }
    json errors = json::array();
    std::vector<std::string> healthy_participants;
    for (auto& fut : futures) {
        auto pair = fut.get();
        agent_outputs[pair.first] = pair.second;
        if (modes::is_error_response(pair.second, pair.first)) {
            std::cerr << "❌ [cascade] " << pair.first
                      << " failed; excluded from synthesis input" << std::endl;
            errors.push_back({{"agent", pair.first},
                              {"detail", pair.second.substr(0, 200)}});
        } else {
            healthy_participants.push_back(pair.first);
        }
    }
    meta["participants"] = participants;
    if (!errors.empty()) meta["errors"] = errors;
    json excluded = json::array();
    for (const auto& name : participants) {
        bool ok = false;
        for (const auto& h : healthy_participants) {
            if (h == name) {
                ok = true;
                break;
            }
        }
        if (!ok) excluded.push_back(name);
    }
    if (!excluded.empty()) meta["excluded"] = excluded;

    // Synthesis reducer: identical prompt shape to pipeline's synthesis stage
    // so users get consistent behavior across modes. The reducer must be in
    // ctx.agents (filter_agents_for_mode in coordinator.cpp ensures this even
    // if the synthesizer isn't part of the cascade roster).
    std::string final_output;
    bool synthesized = false;
    if (!synthesizer_name.empty()) {
        const Agent* synth = nullptr;
        for (const auto& a : ctx.agents) {
            if (a.name == synthesizer_name) { synth = &a; break; }
        }
        if (synth && !healthy_participants.empty()) {
            std::vector<std::pair<std::string, std::string>> synth_blocks;
            synth_blocks.reserve(healthy_participants.size());
            for (const auto& name : healthy_participants) {
                synth_blocks.push_back({name, agent_outputs.value(name, std::string{})});
            }
            std::cout << "🧪 [cascade] synthesis → " << synthesizer_name
                      << " (reducing " << healthy_participants.size()
                      << " healthy response(s)";
            if (healthy_participants.size() != participants.size()) {
                std::cout << "; " << (participants.size() - healthy_participants.size())
                          << " excluded due to errors";
            }
            std::cout << ")" << std::endl;
            const std::string synth_user_prompt =
                mode_module::cascade_synthesis_instruction(synthesis_policy)
                + ctx.user_prompt;
            std::string out = synthesis_tiered::enabled_via_env()
                ? synthesis_tiered::reduce_pairwise(*synth, synth_user_prompt,
                                                    std::move(synth_blocks), false)
                : call_agent(*synth, synthesis_budget::build_cascade_synthesis_prompt(
                                          synth_user_prompt, synth_blocks, synth));
            agent_outputs[synthesizer_name] = out;
            final_output = out;
            synthesized = true;
            meta["synthesizer"] = synthesizer_name;
            std::cout << "✅ [cascade] final from " << synthesizer_name << std::endl;
        } else if (!synth) {
            std::cerr << "⚠️  [cascade] configured synthesizer '" << synthesizer_name
                      << "' is not active; degrading to flat-mode output" << std::endl;
            meta["synthesizer_missing"] = synthesizer_name;
        }
    } else {
        std::cout << "ℹ️  [cascade] no synthesizer configured; emitting parallel outputs only"
                  << std::endl;
    }

    return json{
        {"mode", "cascade"},
        {"agents", agent_outputs},
        {"final", synthesized ? json(final_output) : json(nullptr)},
        {"meta", meta}
    };
}

struct Register {
    Register() {
        modes::register_mode({
            "cascade",
            "Mixture-of-agents — parallel broadcast then a synthesizer reduces all responses into one final answer.",
            run_cascade
        });
    }
} _reg;

} // namespace
