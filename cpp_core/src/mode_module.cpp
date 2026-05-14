#include "mode_module.h"

#include <unordered_set>

namespace mode_module {

using json = nlohmann::json;

std::string option_string(const json& cfg,
                          const std::string& key,
                          const std::string& fallback) {
    return cfg.contains(key) && cfg[key].is_string()
        ? cfg[key].get<std::string>()
        : fallback;
}

json module_meta(const std::string& module_name, const json& cfg) {
    json out = {
        {"module", module_name},
        {"standalone", true}
    };
    for (const auto& key : {
        "variant_policy", "preset", "synthesis_policy", "classifier_policy"
    }) {
        if (cfg.contains(key) && cfg[key].is_string()) out[key] = cfg[key];
    }
    return out;
}

std::string flat_prompt_for_agent(const std::string& user_prompt,
                                  const Agent& agent,
                                  const std::string& variant_policy,
                                  size_t index,
                                  size_t total) {
    if (variant_policy.empty() || variant_policy == "standard") return user_prompt;
    if (variant_policy == "distinct") {
        return "Flat variant policy: produce an independent solution from your role. "
               "Avoid copying the obvious first approach if another reasonable design exists. "
               "Variant " + std::to_string(index + 1) + " of "
               + std::to_string(total) + " from agent '" + agent.name + "'.\n\n"
               "User request:\n" + user_prompt;
    }
    if (variant_policy == "code-alternatives") {
        return "Flat variant policy: if this is a coding task, produce a complete "
               "alternative implementation strategy with build/run notes. State tradeoffs. "
               "Do not merely summarize.\n\nUser request:\n" + user_prompt;
    }
    return user_prompt;
}

std::vector<std::string> pipeline_preset_order(const std::string& preset,
                                               const std::vector<Agent>& agents) {
    if (preset.empty()) return {};
    std::unordered_set<std::string> active;
    for (const auto& a : agents) active.insert(a.name);
    auto has = [&](const std::string& name) { return active.count(name) > 0; };
    auto push_if = [&](std::vector<std::string>& out, const std::string& name) {
        if (has(name)) out.push_back(name);
    };

    std::vector<std::string> out;
    if (preset == "code-quality") {
        push_if(out, "architect");
        push_if(out, "programmer");
        push_if(out, "tester");
        push_if(out, "programmer");
    } else if (preset == "debug-fix") {
        push_if(out, "tester");
        push_if(out, "programmer");
        push_if(out, "tester");
    } else if (preset == "docs-finalize") {
        push_if(out, "programmer");
        push_if(out, "documenter");
    }
    return out;
}

std::string pipeline_stage_prompt(const std::string& staged_prompt,
                                  const std::string& agent_name,
                                  const std::string& preset) {
    if (preset.empty()) return staged_prompt;
    std::string prefix = "Pipeline preset '" + preset + "'. ";
    if (preset == "code-quality") {
        if (agent_name == "tester") {
            prefix += "Audit the previous implementation for compile errors, "
                      "logic bugs, missing files, unsafe types, and prompt mismatch. "
                      "Return concrete findings.";
        } else if (agent_name == "programmer") {
            prefix += "Produce or revise complete runnable code. If prior tester "
                      "findings exist, fix them directly and return a replacement.";
        } else {
            prefix += "Plan the implementation with concrete file/module guidance.";
        }
    } else if (preset == "debug-fix") {
        prefix += "Focus on reproducing, isolating, and fixing defects.";
    } else if (preset == "docs-finalize") {
        prefix += "Focus on complete implementation notes, usage docs, and handoff clarity.";
    }
    return prefix + "\n\n" + staged_prompt;
}

std::string cascade_synthesis_instruction(const std::string& policy) {
    if (policy == "full-code") {
        return "Synthesis policy: preserve complete source files from the best response. "
               "Fix obvious compile issues, but do not compress code into summaries.\n\n";
    }
    if (policy == "best-answer-plus-fixes") {
        return "Synthesis policy: choose the strongest answer, merge only concrete fixes "
               "from other agents, and produce one corrected final answer.\n\n";
    }
    if (policy == "tradeoff-comparison") {
        return "Synthesis policy: compare tradeoffs first, then recommend one path.\n\n";
    }
    return "";
}

std::string router_policy_instruction(const std::string& policy) {
    if (policy == "code") {
        return "Classifier policy: for coding tasks prefer architect, programmer, and tester when available. ";
    }
    if (policy == "debug") {
        return "Classifier policy: prefer tester and programmer for debugging or correction tasks. ";
    }
    if (policy == "docs") {
        return "Classifier policy: prefer api and documenter for documentation/API tasks. ";
    }
    if (policy == "ops") {
        return "Classifier policy: prefer devops and tester for deployment or operations tasks. ";
    }
    return "";
}

}  // namespace mode_module
