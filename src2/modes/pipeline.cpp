#include "mode.h"
#include "../agent_client.h"

#include <algorithm>
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using json = nlohmann::json;

namespace {

bool is_mlx_centric_run(const std::vector<Agent>& agents) {
    int mlx = 0;
    int other = 0;
    for (const auto& a : agents) {
        if (a.engine == "mlx" || a.backend == "mlx") ++mlx;
        else ++other;
    }
    return mlx > 0 && mlx >= other;
}

std::vector<std::string> preferred_names(const std::vector<Agent>& agents,
                                         const std::vector<std::string>& preferred) {
    std::vector<std::string> active;
    active.reserve(agents.size());
    for (const auto& a : agents) active.push_back(a.name);
    std::vector<std::string> out;
    for (const auto& p : preferred) {
        if (std::find(active.begin(), active.end(), p) != active.end()) out.push_back(p);
    }
    return out;
}

std::vector<std::string> default_pipeline_order(const std::vector<Agent>& agents) {
    if (agents.empty()) return {};

    if (is_mlx_centric_run(agents)) {
        // MLX-centric chain: start with mlx-coder if present, then coordinator-like roles.
        auto mlx_pref = preferred_names(agents, {
            "mlx-coder", "foreman", "api", "documenter", "scout",
            "architect", "programmer"
        });
        if (!mlx_pref.empty()) return mlx_pref;
    }

    // Build a coding pipeline from whatever planner/coder/reviewer roles are
    // active. Architect is the preferred planner, but foreman serves the same
    // function in swarms that omit architect. Fall through tiers so we always
    // produce a multi-stage chain when the active agents allow it.
    auto planners = preferred_names(agents, {"architect", "foreman"});
    auto coders   = preferred_names(agents, {"programmer", "mlx-coder", "specialist"});
    auto checkers = preferred_names(agents, {"reviewer", "tester", "security", "documenter"});

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

// Build the staged prompt fed to stage N>1: original request + previous output.
std::string build_staged_prompt(const std::string& user_prompt,
                                const std::string& prev_agent,
                                const std::string& prev_output) {
    std::string out;
    out.reserve(user_prompt.size() + prev_output.size() + 160);
    out += "Original user request:\n<<<\n";
    out += user_prompt;
    out += "\n>>>\n\nPrevious step (";
    out += prev_agent;
    out += ") produced:\n<<<\n";
    out += prev_output;
    out += "\n>>>\n\nContinue the pipeline.";
    return out;
}

// Sequential chain: each stage feeds the next. Order comes from mode_config.
json run_pipeline(const ModeContext& ctx) {
    json agent_outputs = json::object();
    json meta = json::object();

    std::vector<std::string> effective_order;
    bool fallback_order_used = false;
    if (ctx.mode_config.contains("order") && ctx.mode_config["order"].is_array()
        && !ctx.mode_config["order"].empty()) {
        for (const auto& item : ctx.mode_config["order"]) {
            if (item.is_string()) effective_order.push_back(item.get<std::string>());
        }
    }
    if (!effective_order.empty() && is_mlx_centric_run(ctx.agents)) {
        // In MLX-centric runs, require mlx-coder to participate when available.
        std::unordered_map<std::string, const Agent*> by_name_for_check;
        for (const auto& a : ctx.agents) by_name_for_check[a.name] = &a;
        const bool has_mlx_coder = by_name_for_check.find("mlx-coder") != by_name_for_check.end();
        bool order_has_mlx_coder = false;
        for (const auto& n : effective_order) if (n == "mlx-coder") { order_has_mlx_coder = true; break; }
        if (has_mlx_coder && !order_has_mlx_coder) {
            effective_order = default_pipeline_order(ctx.agents);
            fallback_order_used = true;
            std::cerr << "⚠️  [pipeline] overriding static order for MLX-centric run (mlx-coder not in order)" << std::endl;
        } else if (has_mlx_coder && order_has_mlx_coder && !effective_order.empty()
                   && effective_order.front() != "mlx-coder") {
            // Keep configured order but move mlx-coder to the front for MLX-centric runs.
            std::vector<std::string> reordered;
            reordered.reserve(effective_order.size());
            reordered.push_back("mlx-coder");
            for (const auto& n : effective_order) if (n != "mlx-coder") reordered.push_back(n);
            effective_order.swap(reordered);
            fallback_order_used = true;
            std::cerr << "⚠️  [pipeline] reordered static order for MLX-centric run (mlx-coder first)" << std::endl;
        }
    }
    // If a synthesizer is configured, it runs as a final reducer — exclude it
    // from chain construction so it doesn't double-execute as a regular stage.
    std::string synth_name_for_filter;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string()) {
        synth_name_for_filter = ctx.mode_config["synthesizer"].get<std::string>();
    }
    if (effective_order.empty()) {
        // Roster-driven fallback: run EVERY active agent, with planners first,
        // then coders, then checkers, then any remaining roles. This honors the
        // configured roster instead of capping at the 3-stage representative chain.
        const std::vector<std::string> planner_pref  = {"architect", "foreman"};
        const std::vector<std::string> coder_pref    = {"programmer", "mlx-coder", "specialist"};
        const std::vector<std::string> checker_pref  = {"reviewer", "tester", "security", "optimizer", "debugger", "documenter"};
        std::unordered_set<std::string> emitted;
        auto push_if_active = [&](const std::string& name) {
            if (name == synth_name_for_filter) return;
            for (const auto& a : ctx.agents) {
                if (a.name == name && !emitted.count(name)) {
                    effective_order.push_back(name);
                    emitted.insert(name);
                    return;
                }
            }
        };
        for (const auto& n : planner_pref)  push_if_active(n);
        for (const auto& n : coder_pref)    push_if_active(n);
        for (const auto& n : checker_pref)  push_if_active(n);
        // Append any remaining active agents in config order (roster tail).
        for (const auto& a : ctx.agents) {
            if (a.name == synth_name_for_filter) continue;
            if (!emitted.count(a.name)) {
                effective_order.push_back(a.name);
                emitted.insert(a.name);
            }
        }
        fallback_order_used = true;
        std::cerr << "⚠️  [pipeline] roster-driven fallback: " << effective_order.size()
                  << " active agent(s) chained" << std::endl;
    }

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    // Role-equivalent substitutions: when a configured order references an
    // agent that isn't active, try a substitute that fills the same role
    // before silently skipping. Without this, a config that names "architect"
    // in a swarm without one collapses to a single-agent "pipeline".
    const std::vector<std::pair<std::string, std::vector<std::string>>> role_substitutes = {
        {"architect",  {"foreman"}},
        {"foreman",    {"architect"}},
        {"programmer", {"mlx-coder", "specialist"}},
        {"mlx-coder",  {"programmer", "specialist"}},
        {"reviewer",   {"tester", "security"}},
        {"tester",     {"reviewer"}},
    };
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
        std::string sub;
        for (const auto& kv : role_substitutes) {
            if (kv.first != name) continue;
            for (const auto& cand : kv.second) {
                if (by_name.count(cand) && !already_in_order.count(cand)) {
                    sub = cand;
                    break;
                }
            }
            break;
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
        ++step;
        std::cout << "🔗 [pipeline] step " << step << "/" << total
                  << " → " << name << std::endl;

        const std::string staged = prev_agent.empty()
            ? ctx.user_prompt
            : build_staged_prompt(ctx.user_prompt, prev_agent, prev_output);

        std::string result = call_agent(*it->second, staged);
        agent_outputs[name] = result;
        executed.push_back(name);

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
        std::string synth_prompt;
        synth_prompt.reserve(ctx.user_prompt.size() + 256 * executed.size());
        synth_prompt += "Original user request:\n<<<\n";
        synth_prompt += ctx.user_prompt;
        synth_prompt += "\n>>>\n\nThe following agents produced staged outputs:\n";
        int n = 0;
        for (const auto& name : executed) {
            ++n;
            synth_prompt += "\n--- Stage ";
            synth_prompt += std::to_string(n);
            synth_prompt += " (";
            synth_prompt += name;
            synth_prompt += ") ---\n";
            synth_prompt += agent_outputs.value(name, std::string{});
        }
        synth_prompt += "\n\nProduce ONE consolidated answer that integrates the "
                        "above contributions. Resolve contradictions, drop redundancy, "
                        "and keep only the strongest material. Do not enumerate the "
                        "stages — write the final answer directly.";

        std::cout << "🧪 [pipeline] synthesis → " << synthesizer_name
                  << " (reducing " << executed.size() << " stage(s))" << std::endl;
        std::string synth_out = call_agent(*by_name[synthesizer_name], synth_prompt);
        agent_outputs[synthesizer_name] = synth_out;
        final_output = synth_out;
        meta["synthesizer"] = synthesizer_name;
        std::cout << "✅ [pipeline] final from synthesizer " << synthesizer_name << std::endl;
    }

    meta["order"] = executed;
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
