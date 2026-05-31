#include "swarm_config_store.h"
#include "swarm_config_roster.h"

#include <fstream>
#include <iostream>
#include <mutex>

DualWriteOutcome persist_agent_system_prompt(const SwarmPaths& paths,
        const std::string& name, const std::string& system_prompt) {
    DualWriteOutcome o;
    auto apply = [&](json& row) { row["system_prompt"] = system_prompt; };
    o.active_ok = swarm_config_upsert_agent_json_field(paths.active_config_path, name, apply);
    o.source_ok = paths.source_config_path.empty()
        ? false
        : swarm_config_upsert_agent_json_field(paths.source_config_path, name, apply);
    return o;
}

DualWriteOutcome persist_agent_description(const SwarmPaths& paths,
        const std::string& name, const std::string& description) {
    DualWriteOutcome o;
    auto apply = [&](json& row) { row["description"] = description; };
    o.active_ok = swarm_config_upsert_agent_json_field(paths.active_config_path, name, apply);
    o.source_ok = paths.source_config_path.empty()
        ? false
        : swarm_config_upsert_agent_json_field(paths.source_config_path, name, apply);
    return o;
}

DualWriteOutcome persist_agent_tokens(const SwarmPaths& paths,
        const std::string& name, const TokenPersistParams& p) {
    DualWriteOutcome o;
    auto upsert_path = [&](const std::string& path) -> bool {
        if (path.empty()) return false;
        json doc;
        if (!read_swarm_config_doc(path, doc)) return false;
        if (!doc.contains("agents") || !doc["agents"].is_array()) {
            doc["agents"] = json::array();
        }
        bool found = false;
        for (auto& a : doc["agents"]) {
            if (a.is_object() && a.value("name", std::string()) == name) {
                if (p.has_max) a["max_tokens"] = p.max_tokens;
                if (p.has_ctx) a["context"] = p.context;
                if (p.apply_read_timeout) a["read_timeout_secs"] = p.read_timeout_secs;
                found = true;
                break;
            }
        }
        if (!found) {
            json entry = {{"name", name}};
            if (p.has_max) entry["max_tokens"] = p.max_tokens;
            if (p.has_ctx) entry["context"] = p.context;
            if (p.apply_read_timeout) entry["read_timeout_secs"] = p.read_timeout_secs;
            doc["agents"].push_back(entry);
        }
        std::ofstream out(path);
        if (!out.is_open()) return false;
        out << doc.dump(2);
        swarm_config_roster_cache_invalidate(path);
        return true;
    };
    o.active_ok = upsert_path(paths.active_config_path);
    o.source_ok = paths.source_config_path.empty()
        ? true
        : upsert_path(paths.source_config_path);
    return o;
}

bool swarm_write_modes_presets_to_file(const std::string& path,
        const json& modes_config,
        std::mutex& presets_mutex,
        json& presets) {
    if (path.empty()) return false;
    json doc;
    if (!read_swarm_config_doc(path, doc)) return false;
    if (!doc.contains("coordinator") || !doc["coordinator"].is_object()) {
        doc["coordinator"] = json::object();
    }
    doc["coordinator"]["modes"] = modes_config;
    {
        std::lock_guard<std::mutex> lk(presets_mutex);
        if (!presets.empty()) {
            doc["coordinator"]["presets"] = presets;
        } else {
            doc["coordinator"].erase("presets");
        }
    }
    std::ofstream out(path);
    if (!out.is_open()) {
        std::cerr << "❌ [persist] cannot write " << path << std::endl;
        return false;
    }
    out << doc.dump(2);
    return true;
}

bool swarm_mirror_modes_presets(const SwarmPaths& paths,
        const json& modes_config,
        std::mutex& presets_mutex,
        json& presets) {
    bool ok = swarm_write_modes_presets_to_file(paths.active_config_path,
        modes_config, presets_mutex, presets);
    if (!paths.source_config_path.empty()
        && paths.source_config_path != paths.active_config_path) {
        bool src_ok = swarm_write_modes_presets_to_file(paths.source_config_path,
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
