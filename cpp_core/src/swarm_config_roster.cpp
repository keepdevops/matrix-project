#include "swarm_config_roster.h"
#include "swarm_config_store.h"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <unordered_map>
#include <unordered_set>

namespace fs = std::filesystem;

static std::mutex g_roster_cache_mu;

struct RosterSnapshot {
    fs::file_time_type mtime{};
    std::uintmax_t size = 0;
    std::unordered_set<std::string> names;
};

static std::unordered_map<std::string, RosterSnapshot> g_roster_cache;

void swarm_config_roster_cache_invalidate(const std::string& path) {
    if (path.empty()) return;
    std::lock_guard<std::mutex> lk(g_roster_cache_mu);
    g_roster_cache.erase(path);
}

static bool path_identity(const std::string& path, std::uintmax_t& sz, fs::file_time_type& mt) {
    std::error_code ec;
    if (!fs::exists(path, ec)) return false;
    sz = fs::file_size(path, ec);
    mt = fs::last_write_time(path, ec);
    return !ec;
}

bool read_swarm_config_doc(const std::string& path, json& doc) {
    std::ifstream in(path);
    if (!in.is_open()) {
        std::cerr << "❌ [persist] cannot read " << path << std::endl;
        return false;
    }
    try {
        doc = json::parse(in);
    } catch (const std::exception& e) {
        std::cerr << "❌ [persist] parse failed (" << path << "): " << e.what() << std::endl;
        return false;
    }
    return true;
}

bool agent_name_in_persisted_roster(const SwarmPaths& paths, const std::string& name) {
    const std::string& roster_path = !paths.source_config_path.empty()
        ? paths.source_config_path
        : paths.active_config_path;
    if (roster_path.empty()) return false;

    std::uintmax_t sz = 0;
    fs::file_time_type mt{};
    if (!path_identity(roster_path, sz, mt)) return false;

    {
        std::lock_guard<std::mutex> lk(g_roster_cache_mu);
        auto it = g_roster_cache.find(roster_path);
        if (it != g_roster_cache.end()
            && it->second.size == sz
            && it->second.mtime == mt) {
            return it->second.names.count(name) > 0;
        }
    }

    json doc;
    if (!read_swarm_config_doc(roster_path, doc)) return false;
    if (!doc.contains("agents") || !doc["agents"].is_array()) return false;
    std::uintmax_t sz_after = sz;
    fs::file_time_type mt_after = mt;
    path_identity(roster_path, sz_after, mt_after);
    std::unordered_set<std::string> names;
    bool hit = false;
    for (const auto& a : doc["agents"]) {
        if (!a.is_object()) continue;
        const std::string n = a.value("name", std::string());
        if (!n.empty()) names.insert(n);
        if (n == name) hit = true;
    }
    {
        std::lock_guard<std::mutex> lk(g_roster_cache_mu);
        RosterSnapshot snap;
        snap.mtime = mt_after;
        snap.size = sz_after;
        snap.names = std::move(names);
        g_roster_cache[roster_path] = std::move(snap);
    }
    return hit;
}

bool swarm_config_upsert_agent_json_field(const std::string& path, const std::string& name,
    const std::function<void(json&)>& apply_or_build_minimal) {
    if (path.empty()) return false;
    json doc;
    if (!read_swarm_config_doc(path, doc)) return false;
    if (!doc.contains("agents") || !doc["agents"].is_array()) {
        doc["agents"] = json::array();
    }
    bool found = false;
    for (auto& a : doc["agents"]) {
        if (a.is_object() && a.value("name", std::string()) == name) {
            apply_or_build_minimal(a);
            found = true;
            break;
        }
    }
    if (!found) {
        json row = {{"name", name}};
        apply_or_build_minimal(row);
        doc["agents"].push_back(row);
    }
    std::ofstream out(path);
    if (!out.is_open()) return false;
    out << doc.dump(2);
    swarm_config_roster_cache_invalidate(path);
    return true;
}
