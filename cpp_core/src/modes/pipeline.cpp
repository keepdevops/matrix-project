#include "mode.h"
#include "pipeline_exec.h"
#include "pipeline_order.h"
#include "pipeline_stage_run.h"
#include "../agent_client.h"
#include "../mode_module.h"

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
    if (ctx.mode_config.contains("synthesizer") && ctx.mode_config["synthesizer"].is_string())
        synth_name_for_filter = ctx.mode_config["synthesizer"].get<std::string>();

    auto resolved = pipeline_order::resolve_effective_order(ctx, synth_name_for_filter);
    std::vector<std::string> effective_order = std::move(resolved.order);
    const bool fallback_order_used = resolved.fallback_order_used;
    const json substituted = resolved.substitutions;

    pipeline_exec::AgentMap by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::vector<std::string> executed, missing;
    json errors = json::array(), stage_outputs = json::array();
    std::string prev_agent, prev_output, final_output;

    pipeline_stage_run::run_stage_loop(
        ctx, by_name, effective_order, stage_context_chars, preset,
        agent_outputs, stage_outputs, stage_compaction,
        executed, missing, errors, prev_agent, prev_output, final_output);

    if (executed.empty())
        pipeline_exec::run_fallback(ctx, by_name, agent_outputs, stage_outputs,
                                    executed, final_output, meta);
    if (executed.empty()) {
        std::cerr << "❌ [pipeline] no active agents available" << std::endl;
        meta["error"] = "no active agents available for pipeline";
        meta["missing"] = missing;
        meta["fallback_order_used"] = fallback_order_used;
        return json{{"mode","pipeline"},{"agents",agent_outputs},{"final",nullptr},{"meta",meta}};
    }

    std::cout << "✅ [pipeline] final from " << prev_agent << std::endl;

    std::string synthesizer_name;
    if (ctx.mode_config.contains("synthesizer") && ctx.mode_config["synthesizer"].is_string())
        synthesizer_name = ctx.mode_config["synthesizer"].get<std::string>();
    pipeline_exec::run_synthesizer(synthesizer_name, by_name, executed, stage_outputs,
                                   ctx.user_prompt, agent_outputs, final_output, meta);

    meta["order"] = executed;
    meta["stage_outputs"] = stage_outputs;
    meta["stage_compaction"] = stage_compaction;
    meta["missing"] = missing;
    meta["fallback_order_used"] = fallback_order_used;
    if (!errors.empty()) meta["errors"] = errors;
    if (!substituted.empty()) meta["substitutions"] = substituted;
    return json{{"mode","pipeline"},{"agents",agent_outputs},{"final",final_output},{"meta",meta}};
}

struct Register {
    Register() { modes::register_mode({"pipeline", "Sequential chain — each agent receives the previous agent's output.", run_pipeline}); }
} _reg;

} // namespace
