#pragma once
// Inline pipeline stage-iteration helper — included only by pipeline.cpp.

#include "mode.h"
#include "pipeline_exec.h"
#include "pipeline_prompts.h"
#include "pipeline_stage_loop.h"
#include "../agent_client.h"
#include "../mode_module.h"

#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace pipeline_stage_run {

using json = nlohmann::json;

inline void run_stage_loop(
    const ModeContext& ctx,
    const pipeline_exec::AgentMap& by_name,
    const std::vector<std::string>& effective_order,
    int stage_context_chars,
    const std::string& preset,
    json& agent_outputs,
    json& stage_outputs,
    json& stage_compaction,
    std::vector<std::string>& executed,
    std::vector<std::string>& missing,
    json& errors,
    std::string& prev_agent,
    std::string& prev_output,
    std::string& final_output
) {
    const size_t total = effective_order.size();
    size_t step = 0;
    for (const auto& name : effective_order) {
        auto it = by_name.find(name);
        if (it == by_name.end()) {
            std::cerr << "⚠️  [pipeline] skipping unknown agent '" << name << "'" << std::endl;
            missing.push_back(name); continue;
        }
        if (ctx.quality_pass && name != ctx.quality_pass_target) {
            std::cout << "⏭️  [pipeline] quality_pass: skipping stage '" << name << "'" << std::endl;
            continue;
        }
        ++step;
        std::cout << "🔗 [pipeline] step " << step << "/" << total
                  << " → " << name << (ctx.quality_pass ? " (quality pass)" : "") << std::endl;

        std::string prev_for_prompt = pipeline_stage::compact_context(
            prev_output, prev_agent, stage_context_chars, (int)step, stage_compaction);
        const std::string staged = prev_agent.empty()
            ? ctx.prompt_for(name)
            : build_pipeline_staged_user_prompt(ctx.prompt_for(name), prev_agent, prev_for_prompt);
        std::string result = call_agent(*it->second,
            mode_module::pipeline_stage_prompt(staged, name, preset));
        agent_outputs[name] = result;
        executed.push_back(name);
        stage_outputs.push_back({{"step", (int)step}, {"agent", name}, {"output", result}});

        if (modes::is_error_response(result, name)) {
            std::cerr << "❌ [pipeline] step " << step << " (" << name
                      << ") failed; downstream stages will use the last good output" << std::endl;
            errors.push_back({{"step", (int)step}, {"agent", name}, {"detail", result.substr(0, 200)}});
        } else {
            prev_agent = name; prev_output = result; final_output = result;
        }
    }
}

} // namespace pipeline_stage_run
