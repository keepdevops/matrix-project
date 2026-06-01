#pragma once
// Inline synthesis helpers — included only by cascade_exec.h.

#include "mode.h"
#include "../agent_client.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"
#include "../mode_module.h"

#include <iostream>
#include <string>
#include <utility>
#include <vector>

namespace cascade_exec {

using json = nlohmann::json;

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
