#include "coordinator_routes_architect_stream_modes.h"
#include "agent_client.h"
#include "modes/router_selected_parse.h"

#include <map>
#include <unordered_set>

void run_stream_router_mode(const std::vector<Agent>& agents,
                            const nlohmann::json& cfg,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs) {
    std::string classifier_name = cfg.value("classifier", std::string(""));
    int max_select = cfg.value("max_select", 3);
    std::map<std::string, const Agent*> by_name;
    for (const auto& a : agents) by_name[a.name] = &a;
    if (classifier_name.empty() || !by_name.count(classifier_name)) {
        if (!agents.empty()) classifier_name = agents.front().name;
    }
    std::vector<std::string> choices;
    for (const auto& a : agents) {
        if (a.name != classifier_name) choices.push_back(a.name);
    }
    std::string choices_csv;
    for (size_t i = 0; i < choices.size(); ++i) {
        if (i) choices_csv += ", ";
        choices_csv += choices[i];
    }
    std::string classifier_user =
        "Allowed agents: " + choices_csv + "\n\nUser request:\n" +
        prompt + "\n\nRespond with one line: SELECTED: <agents>.";
    std::string classifier_system =
        "You are a routing classifier. Pick 1-" + std::to_string(max_select) +
        " agents from the allowed list. Respond with exactly one line: "
        "SELECTED: <a>, <b>. No prose.";
    std::string raw;
    if (by_name.count(classifier_name)) {
        try {
            raw = call_agent_with_system(*by_name[classifier_name],
                classifier_system, classifier_user);
        } catch (...) { raw = ""; }
    }
    std::unordered_set<std::string> valid_names;
    for (const auto& kv : by_name) valid_names.insert(kv.first);
    std::vector<std::string> picked = parse_router_selected_agents(
        raw, max_select, valid_names, classifier_name);
    if (picked.empty() && !choices.empty()) picked.push_back(choices.front());
    write_event("selected", nlohmann::json({
        {"classifier", classifier_name}, {"agents", picked}
    }).dump());
    std::vector<const Agent*> selected_agents;
    for (const auto& n : picked) selected_agents.push_back(by_name[n]);
    stream_parallel_agents(selected_agents, prompt, cancel, write_event, outputs);
}
