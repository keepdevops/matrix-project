#include "router_classifier.h"
#include "../mode_module.h"
#include "../pressure.h"

#include <cmath>
#include <iostream>
#include <map>

namespace router_classifier {

std::string choose_classifier(const std::vector<Agent>& agents) {
    for (const auto& a : agents)
        for (const auto& t : a.tags)
            if (t == "planning") return a.name;
    return agents.empty() ? std::string() : agents.front().name;
}

ClassifierPrompt build_classifier_prompt(
    const std::vector<std::string>& choices,
    const std::unordered_map<std::string, const Agent*>& by_name,
    const std::vector<Agent>& agents,
    const std::string& user_prompt,
    int max_select,
    const std::string& classifier_policy) {
    ClassifierPrompt out;
    std::string choices_annotated;
    for (size_t i = 0; i < choices.size(); ++i) {
        const auto it = by_name.find(choices[i]);
        const std::string desc = (it != by_name.end() && !it->second->description.empty())
            ? it->second->description : "";
        choices_annotated += "  " + choices[i];
        if (!desc.empty()) choices_annotated += " — " + desc;
        choices_annotated += "\n";
    }
    out.system =
        "You are a routing classifier. Your ONLY job is to choose which "
        "specialist agents should handle a user request and optionally adjust "
        "their token budgets for this request.\n\n"
        "Respond with ONLY the following lines (in order) and nothing else:\n"
        "  [optional] SET_TOKENS: <agent> max_tokens=<n>   — raise budget for large tasks\n"
        "  SELECTED: <agent1>, <agent2>, ...\n\n"
        "Rules:\n"
        "- Emit SET_TOKENS lines BEFORE the SELECTED line.\n"
        "- Only emit SET_TOKENS when the task clearly requires more output than the "
        "default budget (e.g. large codegen needs max_tokens=4096, deep analysis "
        "needs max_tokens=3000). Default is 2048. Never lower below 512.\n"
        "- Pick between 1 and " + std::to_string(max_select) + " agents from the "
        "allowed list. Use only names from the allowed list.\n"
        "- No prose, no explanations, no other lines.\n"
        + mode_module::router_policy_instruction(classifier_policy);

    std::string load_banner;
    try {
        nlohmann::json snap = snapshot_pressure(agents);
        std::map<std::string, int> agent_pct;
        for (const auto& entry : snap) {
            if (!entry.is_object()) continue;
            double usage = entry.value("usage", 0.0);
            int pct = (int)std::round(usage * 100.0);
            if (entry.contains("names") && entry["names"].is_array()) {
                for (const auto& n : entry["names"]) {
                    if (n.is_string()) agent_pct[n.get<std::string>()] = pct;
                }
            }
        }
        for (const auto& name : choices) {
            auto it = agent_pct.find(name);
            int pct = (it != agent_pct.end()) ? it->second : 0;
            if (!out.load_csv.empty()) out.load_csv += ", ";
            out.load_csv += name + " " + std::to_string(pct) + "%";
        }
        if (!out.load_csv.empty()) {
            load_banner = "Current load: " + out.load_csv +
                          ". Prefer less-loaded agents when multiple fit the task.\n\n";
            std::cout << "📊 [router] load hint sent to classifier: "
                      << out.load_csv << std::endl;
        }
    } catch (...) {}

    out.user =
        "Allowed agents:\n" + choices_annotated + "\n"
        + load_banner +
        "User request:\n" + user_prompt + "\n\n"
        "Respond with the SELECTED line only.";
    return out;
}

}  // namespace router_classifier
