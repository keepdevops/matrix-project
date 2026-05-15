#include "coordinator_routes_internal.h"

#include <map>
#include <mutex>
#include <set>

std::vector<Agent> filter_agents_for_mode(CoordinatorState& st, const std::string& mode_name) {
    std::lock_guard<std::mutex> lock(st.modes_config_mutex);
    if (!st.modes_config.contains(mode_name)) return st.agents;
    const auto& cfg = st.modes_config[mode_name];
    if (!cfg.contains("agents") || !cfg["agents"].is_array() || cfg["agents"].empty()) {
        return st.agents;
    }
    std::map<std::string, const Agent*> by_name;
    for (const auto& a : st.agents) by_name[a.name] = &a;
    std::vector<Agent> filtered;
    std::set<std::string> picked;
    for (const auto& item : cfg["agents"]) {
        if (!item.is_string()) continue;
        const std::string n = item.get<std::string>();
        auto it = by_name.find(n);
        if (it != by_name.end() && (mode_name == "pipeline" || picked.insert(n).second)) {
            filtered.push_back(*it->second);
            picked.insert(n);
        }
    }
    for (const auto& key : {"synthesizer"}) {
        if (cfg.contains(key) && cfg[key].is_string()) {
            const std::string n = cfg[key].get<std::string>();
            auto it = by_name.find(n);
            if (it != by_name.end() && picked.insert(n).second) {
                filtered.push_back(*it->second);
            }
        }
    }
    return filtered.empty() ? st.agents : filtered;
}
