#include "mode.h"
#include "pipeline_prompts.h"
#include "../agent_client.h"
#include "../mode_module.h"
#include "../synthesis_budget.h"
#include "../synthesis_tiered.h"

#include <algorithm>
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {


std::vector<std::string> default_pipeline_order(const std::vector<Agent>& agents) {
    if (agents.empty()) return {};

    // Build a pipeline from tag-grouped roles: planning → coding → review.
    auto planners = mode_module::agents_with_tag(agents, "planning");
    auto coders   = mode_module::agents_with_tag(agents, "coding");
    auto checkers = mode_module::agents_with_tag(agents, "review");

    std::vector<std::string> out;
    auto push_first = [&](const std::vector<std::string>& xs) {
        if (!xs.empty()) out.push_back(xs.front());
    };
    push_first(planners);
    push_first(coders);
    push_first(checkers);

    if (!out.empty()) return out;

    // Final fallback: first two active agents in config order.
    out.push_back(agents.front().name);
    if (agents.size() > 1) out.push_back(agents[1].name);
    return out;
}

// Sequential chain: each stage feeds the next. Order comes from mode_config.
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

    std::vector<std::string> effective_order;
    bool fallback_order_used = false;
    if (ctx.mode_config.contains("order") && ctx.mode_config["order"].is_array()
        && !ctx.mode_config["order"].empty()) {
        for (const auto& item : ctx.mode_config["order"]) {
            if (item.is_string()) effective_order.push_back(item.get<std::string>());
        }
    }
    // If a synthesizer is configured, it runs as a final reducer — exclude it
    // from chain construction so it doesn't double-execute as a regular stage.
    std::string synth_name_for_filter;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string()) {
        synth_name_for_filter = ctx.mode_config["synthesizer"].get<std::string>();
    }
    if (effective_order.empty()
        && ctx.mode_config.contains("agents")
        && ctx.mode_config["agents"].is_array()
        && !ctx.mode_config["agents"].empty()) {
        for (const auto& item : ctx.mode_config["agents"]) {
            if (!item.is_string()) continue;
            const std::string name = item.get<std::string>();
            if (name == synth_name_for_filter) continue;
            effective_order.push_back(name);
        }
    }
    if (effective_order.empty() && !preset.empty()) {
        effective_order = mode_module::pipeline_preset_order(preset, ctx.agents);
    }
    if (effective_order.empty()) {
        // Roster-driven fallback: run EVERY active agent, with planning first,
        // then coding, then review, then any remaining roles (data, synthesis, etc.).
        std::unordered_set<std::string> emitted;
        const std::vector<std::string> tag_order = {"planning", "coding", "review", "data", "synthesis"};
        for (const auto& tag : tag_order) {
            for (const auto& name : mode_module::agents_with_tag(ctx.agents, tag)) {
                if (name == synth_name_for_filter) continue;
                if (emitted.insert(name).second) effective_order.push_back(name);
            }
        }
        // Append any remaining agents not covered by known tags.
        for (const auto& a : ctx.agents) {
            if (a.name == synth_name_for_filter) continue;
            if (emitted.insert(a.name).second) effective_order.push_back(a.name);
        }
        fallback_order_used = true;
        std::cerr << "⚠️  [pipeline] roster-driven fallback: " << effective_order.size()
                  << " active agent(s) chained" << std::endl;
    }

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    // Role substitution: when a configured order names an agent that isn't active,
    // find the first active agent with the same tags before silently skipping.
    std::unordered_map<std::string, std::string> substituted;
    std::vector<std::string> resolved_order;
    std::unordered_set<std::string> already_in_order(effective_order.begin(),
                                                     effective_order.end());
    std::unordered_set<std::string> seen_resolved;
    for (const auto& name : effective_order) {
        if (by_name.count(name)) {
            if (seen_resolved.insert(name).second) resolved_order.push_back(name);
            continue;
        }
        // Find the missing agent's tags from the full ctx.agents list (it may be
        // unconfigured for this run). Fall back to first same-tag active agent.
        std::vector<std::string> missing_tags;
        for (const auto& a : ctx.agents)
            if (a.name == name) { missing_tags = a.tags; break; }
        std::string sub;
        for (const auto& tag : missing_tags) {
            for (const auto& cand : mode_module::agents_with_tag(ctx.agents, tag)) {
                if (by_name.count(cand) && !already_in_order.count(cand)) {
                    sub = cand; break;
                }
            }
            if (!sub.empty()) break;
        }
        if (!sub.empty()) {
            substituted[name] = sub;
            already_in_order.insert(sub);
            if (seen_resolved.insert(sub).second) resolved_order.push_back(sub);
            std::cerr << "⚠️  [pipeline] substituting missing '" << name
                      << "' with active '" << sub << "'" << std::endl;
        }
    }
    effective_order.swap(resolved_order);

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
        // Quality pass: only execute the target stage; skip all others.
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
            ? ctx.user_prompt
            : build_pipeline_staged_user_prompt(ctx.user_prompt, prev_agent, prev_for_prompt);
        const std::string stage_prompt = mode_module::pipeline_stage_prompt(staged, name, preset);

        std::string result = call_agent(*it->second, stage_prompt);
        agent_outputs[name] = result;
        executed.push_back(name);
        stage_outputs.push_back({
            {"step", (int)step},
            {"agent", name},
            {"output", result}
        });

        // Skip-with-warning: a failed stage is recorded in meta.errors[] but
        // does NOT poison downstream stages — they continue from the last
        // successful output. Without this, one transient timeout cascades
        // garbage through the rest of the chain.
        if (modes::is_error_response(result, name)) {
            std::cerr << "❌ [pipeline] step " << step << " (" << name
                      << ") failed; downstream stages will use the last good output" << std::endl;
            errors.push_back({{"step", (int)step}, {"agent", name},
                              {"detail", result.substr(0, 200)}});
            // Leave prev_agent/prev_output/final_output unchanged.
        } else {
            prev_agent = name;
            prev_output = result;
            final_output = result;
        }
    }

    if (executed.empty()) {
        // Last-resort fallback: run first active agent so mode always produces output.
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

    // Optional synthesis stage: if mode_config["synthesizer"] names an active
    // agent, run it as a reducer over ALL stage outputs and use its result as
    // the canonical final answer. Without this, only the last agent's output
    // becomes `final` and earlier work is invisible to downstream callers.
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

struct Register {
    Register() {
        modes::register_mode({
            "pipeline",
            "Sequential chain — each agent receives the previous agent's output.",
            run_pipeline
        });
    }
} _reg;

} // namespace
