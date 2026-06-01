#pragma once
// Inline atomic-write helpers for swarm_config_store.cpp only.

#include "swarm_config_store.h"
#include "swarm_config_roster.h"
#include <fstream>
#include <iostream>
#include <mutex>

namespace store_write {

using json = nlohmann::json;

inline bool write_modes_presets_to_file(const std::string& path,
        const json& modes_config,
        std::mutex& presets_mutex,
        json& presets) {
    if (path.empty()) return false;
    json doc;
    if (!read_swarm_config_doc(path, doc)) return false;
    if (!doc.contains("coordinator") || !doc["coordinator"].is_object())
        doc["coordinator"] = json::object();
    doc["coordinator"]["modes"] = modes_config;
    {
        std::lock_guard<std::mutex> lk(presets_mutex);
        if (!presets.empty())
            doc["coordinator"]["presets"] = presets;
        else
            doc["coordinator"].erase("presets");
    }
    std::ofstream out(path);
    if (!out.is_open()) {
        std::cerr << "❌ [persist] cannot write " << path << std::endl;
        return false;
    }
    out << doc.dump(2);
    return true;
}

inline bool mirror_modes_presets(const SwarmPaths& paths,
        const json& modes_config,
        std::mutex& presets_mutex,
        json& presets) {
    bool ok = write_modes_presets_to_file(paths.active_config_path,
        modes_config, presets_mutex, presets);
    if (!paths.source_config_path.empty()
        && paths.source_config_path != paths.active_config_path) {
        bool src_ok = write_modes_presets_to_file(paths.source_config_path,
            modes_config, presets_mutex, presets);
        if (src_ok) {
            std::cout << "💾 [persist] mirrored modes to source "
                      << paths.source_config_path << std::endl;
        } else {
            std::cerr << "⚠️  [persist] active config saved but source "
                      << paths.source_config_path
                      << " could not be updated (edits will not survive redeploy)"
                      << std::endl;
        }
    }
    return ok;
}

} // namespace store_write
