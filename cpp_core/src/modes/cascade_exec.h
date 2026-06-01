#pragma once
// Inline helpers for cascade parallel broadcast and synthesis.
// Included only by cascade.cpp.

#include "mode.h"
#include "../agent_client.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"
#include "../mode_module.h"

#include <future>
#include <iostream>
#include <string>
#include <utility>
#include <vector>

namespace cascade_exec {

using json = nlohmann::json;

struct BroadcastResult {
    json agent_outputs = json::object();
    json errors        = json::array();
    std::vector<std::string> participants;
    std::vector<std::string> healthy;
};

inline BroadcastResult run_parallel_broadcast(
    const ModeContext& ctx,
    const std::string& synthesizer_name
) {
    BroadcastResult r;
    std::vector<std::future<std::pair<std::string, std::string>>> futures;
    bool qp_target_found = false;

    for (const auto& a : ctx.agents) {
        if (a.name == synthesizer_name) continue;
        if (ctx.quality_pass && a.name != ctx.quality_pass_target) {
            std::cout << "⏭️  [cascade] quality_pass: skipping '" << a.name << "'" << std::endl;
            continue;
        }
        if (ctx.quality_pass) qp_target_found = true;
        r.participants.push_back(a.name);
        const std::string prompt = ctx.prompt_for(a.name);
        const Agent agent = a;
        futures.push_back(std::async(std::launch::async, [prompt, agent]() {
            return std::make_pair(agent.name, call_agent(agent, prompt));
        }));
    }
    if (ctx.quality_pass && !qp_target_found) {
        std::cerr << "⚠️  [cascade] quality_pass target '" << ctx.quality_pass_target
                  << "' not in roster — no agents called" << std::endl;
    }
    for (auto& fut : futures) {
        auto pair = fut.get();
        r.agent_outputs[pair.first] = pair.second;
        if (modes::is_error_response(pair.second, pair.first)) {
            std::cerr << "❌ [cascade] " << pair.first
                      << " failed; excluded from synthesis input" << std::endl;
            r.errors.push_back({{"agent", pair.first},
                                 {"detail", pair.second.substr(0, 200)}});
        } else {
            r.healthy.push_back(pair.first);
        }
    }
    return r;
}

// Returns the synthesized output string, or empty if synthesis was skipped/failed.
inline std::string run_synthesizer(
    const ModeContext& ctx,
    const std::string& synthesizer_name,
    const std::string& synthesis_policy,
    const BroadcastResult& br,
    json& agent_outputs,
    json& meta
) {
    if (synthesizer_name.empty()) {
        std::cout << "ℹ️  [cascade] no synthesizer configured; emitting parallel outputs only"
                  << std::endl;
        return {};
    }
    const Agent* synth = nullptr;
    for (const auto& a : ctx.agents)
        if (a.name == synthesizer_name) { synth = &a; break; }

    if (!synth) {
        std::cerr << "⚠️  [cascade] configured synthesizer '" << synthesizer_name
                  << "' is not active; degrading to flat-mode output" << std::endl;
        meta["synthesizer_missing"] = synthesizer_name;
        return {};
    }
    if (br.healthy.empty()) return {};

    std::vector<std::pair<std::string, std::string>> synth_blocks;
    synth_blocks.reserve(br.healthy.size());
    for (const auto& name : br.healthy)
        synth_blocks.push_back({name, br.agent_outputs.value(name, std::string{})});

    std::cout << "🧪 [cascade] synthesis → " << synthesizer_name
              << " (reducing " << br.healthy.size() << " healthy response(s)";
    if (br.healthy.size() != br.participants.size())
        std::cout << "; " << (br.participants.size() - br.healthy.size())
                  << " excluded due to errors";
    std::cout << ")" << std::endl;

    const std::string synth_prompt =
        mode_module::cascade_synthesis_instruction(synthesis_policy) + ctx.user_prompt;
    std::string out = synthesis_tiered::enabled_via_env()
        ? synthesis_tiered::reduce_pairwise(*synth, synth_prompt, std::move(synth_blocks), false)
        : call_agent(*synth, synthesis_budget::build_cascade_synthesis_prompt(
                                  synth_prompt, synth_blocks, synth));
    agent_outputs[synthesizer_name] = out;
    meta["synthesizer"] = synthesizer_name;
    std::cout << "✅ [cascade] final from " << synthesizer_name << std::endl;
    return out;
}

} // namespace cascade_exec
