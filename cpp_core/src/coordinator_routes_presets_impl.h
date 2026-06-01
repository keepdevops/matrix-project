#pragma once
// Inline helpers for the preset-apply handler.
// Included only by coordinator_routes_presets.cpp.

#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include <set>
#include <string>

namespace presets_impl {

struct ApplyBlock {
    json block   = json::object();
    json unknown = json::array();
};

// Build the per-mode config block from a preset bundle, filtering unknown agents.
inline ApplyBlock build_apply_block(const json& bundle,
                                     const std::set<std::string>& active_names) {
    ApplyBlock r;
    if (bundle.contains("agents") && bundle["agents"].is_array()) {
        json kept = json::array();
        for (const auto& it : bundle["agents"]) {
            if (!it.is_string()) continue;
            const std::string n = it.get<std::string>();
            if (active_names.count(n)) kept.push_back(n);
            else r.unknown.push_back(n);
        }
        if (!kept.empty()) r.block["agents"] = kept;
    }
    if (bundle.contains("synthesizer") && bundle["synthesizer"].is_string()) {
        const std::string sn = bundle["synthesizer"].get<std::string>();
        if (active_names.count(sn)) r.block["synthesizer"] = sn;
        else r.unknown.push_back(sn);
    }
    if (bundle.contains("max_select") && bundle["max_select"].is_number_integer())
        r.block["max_select"] = bundle["max_select"];
    return r;
}

// Merge block into modes_config[mode_name], clearing preset-owned fields first, then persist.
inline bool merge_and_persist(CoordinatorState& st,
                               const std::string& mode_name,
                               const json& block) {
    std::lock_guard<std::mutex> lk(st.modes_config_mutex);
    if (!st.modes_config.contains(mode_name) || !st.modes_config[mode_name].is_object())
        st.modes_config[mode_name] = json::object();
    // Drop preset-owned fields so a smaller preset doesn't inherit stale values.
    st.modes_config[mode_name].erase("agents");
    st.modes_config[mode_name].erase("synthesizer");
    st.modes_config[mode_name].erase("max_select");
    for (auto it = block.begin(); it != block.end(); ++it)
        st.modes_config[mode_name][it.key()] = it.value();
    return coordinator_persist_modes_locked(st);
}

} // namespace presets_impl
