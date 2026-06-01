#include "mode.h"
#include "pipeline_order.h"
#include "pipeline_prompts.h"
#include "../agent_client.h"
#include "../mode_module.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"

#include <iostream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

json run_pipeline(const ModeContext& ctx) {
    json agent_outputs = json::object();
    json meta = mode_module::module_meta("pipeline", ctx.mode_config);
    const std::string preset = mode_module::option_string(ctx.mode_config, "preset", "");
    if (!preset.empty()) meta["preset"] = preset;
    const int stage_context_chars =
        ctx.mode_config.contains("stage_context_chars")
        && ctx.mode_config["stage_context_chars"].is_number_integer()
            ? ctx.mode_config["stage_context_chars"].get<int>()
            : 24000;
    json stage_compaction = json::array();

    std::string synth_name_for_filter;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string()) {
        synth_name_for_filter = ctx.mode_config["synthesizer"].get<std::string>();
    }

    auto resolved = pipeline_order::resolve_effective_order(ctx, synth_name_for_filter);
    std::vector<std::string> effective_order = std::move(resolved.order);
    const bool fallback_order_used = resolved.fallback_order_used;
    const json substituted = resolved.substitutions;

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::vector<std::string> executed;
    std::vector<std::string> missing;
    json errors = json::array();
    json stage_outputs = json::array();

    std::string prev_agent;
    std::string prev_output;
    std::string final_output;

    const size_t total = effective_order.size();
    size_t step = 0;
    for (const auto& name : effective_order) {
        auto it = by_name.find(name);
        if (it == by_name.end()) {
            std::cerr << "⚠️  [pipeline] skipping unknown agent '" << name << "'" << std::endl;
            missing.push_back(name);
            continue;
        }
        if (ctx.quality_pass && name != ctx.quality_pass_target) {
            std::cout << "⏭️  [pipeline] quality_pass: skipping stage '" << name << "'" << std::endl;
            continue;
        }
        ++step;
        std::cout << "🔗 [pipeline] step " << step << "/" << total
                  << " → " << name << (ctx.quality_pass ? " (quality pass)" : "")
                  << std::endl;

        std::string prev_for_prompt = prev_output;
        if (!prev_agent.empty() && stage_context_chars > 0
            && prev_for_prompt.size() > static_cast<size_t>(stage_context_chars)) {
            const size_t half = static_cast<size_t>(stage_context_chars) / 2;
            prev_for_prompt =
                prev_for_prompt.substr(0, half)
                + "\n\n[... previous stage output compacted ...]\n\n"
                + prev_for_prompt.substr(prev_for_prompt.size() - half);
            stage_compaction.push_back({
                {"before_step", (int)step},
                {"source_agent", prev_agent},
                {"original_chars", (int)prev_output.size()},
                {"kept_chars", (int)prev_for_prompt.size()}
            });
        }
        const std::string staged = prev_agent.empty()
            ? ctx.prompt_for(name)
            : build_pipeline_staged_user_prompt(ctx.prompt_for(name), prev_agent, prev_for_prompt);
        const std::string stage_prompt = mode_module::pipeline_stage_prompt(staged, name, preset);

        std::string result = call_agent(*it->second, stage_prompt);
        agent_outputs[name] = result;
        executed.push_back(name);
        stage_outputs.push_back({
            {"step", (int)step},
            {"agent", name},
            {"output", result}
        });

        if (modes::is_error_response(result, name)) {
            std::cerr << "❌ [pipeline] step " << step << " (" << name
                      << ") failed; downstream stages will use the last good output" << std::endl;
            errors.push_back({{"step", (int)step}, {"agent", name},
                              {"detail", result.substr(0, 200)}});
        } else {
            prev_agent = name;
            prev_output = result;
            final_output = result;
        }
    }

    if (executed.empty()) {
        if (!ctx.agents.empty()) {
            const Agent& a0 = ctx.agents.front();
            std::cerr << "⚠️  [pipeline] no configured agents matched; falling back to "
                      << a0.name << std::endl;
            std::string result = call_agent(a0, ctx.user_prompt);
            agent_outputs[a0.name] = result;
            final_output = result;
            executed.push_back(a0.name);
            stage_outputs.push_back({
                {"step", 1},
                {"agent", a0.name},
                {"output", result}
            });
            meta["fallback_single_agent"] = a0.name;
        }
    }

    if (executed.empty()) {
        std::cerr << "❌ [pipeline] no active agents available" << std::endl;
        meta["error"] = "no active agents available for pipeline";
        meta["missing"] = missing;
        meta["fallback_order_used"] = fallback_order_used;
        return json{
            {"mode", "pipeline"},
            {"agents", agent_outputs},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::cout << "✅ [pipeline] final from " << prev_agent << std::endl;

    std::string synthesizer_name;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string()) {
        synthesizer_name = ctx.mode_config["synthesizer"].get<std::string>();
    }
    if (!synthesizer_name.empty() && by_name.count(synthesizer_name)
        && executed.size() >= 1) {
        std::vector<std::pair<std::string, std::string>> synth_blocks;
        synth_blocks.reserve(stage_outputs.size());
        for (const auto& stage : stage_outputs) {
            if (!stage.is_object()) continue;
            const int stage_num = stage.value("step", 0);
            const std::string name = stage.value("agent", std::string{});
            const std::string label = name + " stage " + std::to_string(stage_num);
            synth_blocks.push_back({label, stage.value("output", std::string{})});
        }
        const Agent& synth_ref = *by_name[synthesizer_name];

        std::cout << "🧪 [pipeline] synthesis → " << synthesizer_name
                  << " (reducing " << executed.size() << " stage(s))" << std::endl;
        std::string synth_out = synthesis_tiered::enabled_via_env()
            ? synthesis_tiered::reduce_pairwise(synth_ref, ctx.user_prompt,
                                               std::move(synth_blocks), true)
            : call_agent(synth_ref, synthesis_budget::build_pipeline_synthesis_prompt(
                                         ctx.user_prompt, synth_blocks, &synth_ref));
        agent_outputs[synthesizer_name] = synth_out;
        final_output = synth_out;
        meta["synthesizer"] = synthesizer_name;
        std::cout << "✅ [pipeline] final from synthesizer " << synthesizer_name << std::endl;
    }

    meta["order"] = executed;
    meta["stage_outputs"] = stage_outputs;
    meta["stage_compaction"] = stage_compaction;
    meta["missing"] = missing;
    meta["fallback_order_used"] = fallback_order_used;
    if (!errors.empty()) meta["errors"] = errors;
    if (!substituted.empty()) meta["substitutions"] = substituted;
    return json{
        {"mode", "pipeline"},
        {"agents", agent_outputs},
        {"final", final_output},
        {"meta", meta}
    };
}

}  // namespace

namespace modes {

nlohmann::json run_pipeline_mode(const ModeContext& ctx) { return run_pipeline(ctx); }

}  // namespace modes
