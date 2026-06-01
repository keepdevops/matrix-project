#pragma once
// Inline helpers for pipeline fallback and synthesis steps.
// Included only by pipeline.cpp.

#include "mode.h"
#include "../agent_client.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"
#include <iostream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace pipeline_exec {

using json = nlohmann::json;
using AgentMap = std::unordered_map<std::string, const Agent*>;

// Fallback when no configured agents executed: call the first available agent directly.
inline void run_fallback(
    const ModeContext& ctx,
    const AgentMap& by_name,
    json& agent_outputs,
    json& stage_outputs,
    std::vector<std::string>& executed,
    std::string& final_output,
    json& meta
) {
    if (ctx.agents.empty()) return;
    const Agent& a0 = ctx.agents.front();
    std::cerr << "⚠️  [pipeline] no configured agents matched; falling back to "
              << a0.name << std::endl;
    std::string result = call_agent(a0, ctx.user_prompt);
    agent_outputs[a0.name] = result;
    final_output = result;
    executed.push_back(a0.name);
    stage_outputs.push_back({{"step", 1}, {"agent", a0.name}, {"output", result}});
    meta["fallback_single_agent"] = a0.name;
}

// Synthesize stage outputs through the named synthesizer agent.
inline void run_synthesizer(
    const std::string& synthesizer_name,
    const AgentMap& by_name,
    const std::vector<std::string>& executed,
    const json& stage_outputs,
    const std::string& user_prompt,
    json& agent_outputs,
    std::string& final_output,
    json& meta
) {
    if (synthesizer_name.empty() || !by_name.count(synthesizer_name) || executed.empty())
        return;
    std::vector<std::pair<std::string, std::string>> synth_blocks;
    synth_blocks.reserve(stage_outputs.size());
    for (const auto& stage : stage_outputs) {
        if (!stage.is_object()) continue;
        const int stage_num = stage.value("step", 0);
        const std::string name = stage.value("agent", std::string{});
        synth_blocks.push_back({name + " stage " + std::to_string(stage_num),
                                 stage.value("output", std::string{})});
    }
    const Agent& synth_ref = *by_name.at(synthesizer_name);
    std::cout << "🧪 [pipeline] synthesis → " << synthesizer_name
              << " (reducing " << executed.size() << " stage(s))" << std::endl;
    std::string synth_out = synthesis_tiered::enabled_via_env()
        ? synthesis_tiered::reduce_pairwise(synth_ref, user_prompt, std::move(synth_blocks), true)
        : call_agent(synth_ref, synthesis_budget::build_pipeline_synthesis_prompt(
                                     user_prompt, synth_blocks, &synth_ref));
    agent_outputs[synthesizer_name] = synth_out;
    final_output = synth_out;
    meta["synthesizer"] = synthesizer_name;
    std::cout << "✅ [pipeline] final from synthesizer " << synthesizer_name << std::endl;
}

} // namespace pipeline_exec
