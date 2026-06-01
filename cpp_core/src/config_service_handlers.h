#pragma once
#include "json.hpp"
#include <fstream>
#include <string>

using json = nlohmann::json;

namespace config_svc {

inline bool read_doc(const std::string& path, json& doc) {
    std::ifstream in(path);
    if (!in.is_open()) return false;
    try {
        doc = json::parse(in);
    } catch (...) {
        return false;
    }
    return true;
}

inline bool atomic_write_doc(const std::string& path, const json& doc) {
    const std::string tmp = path + ".tmp";
    {
        std::ofstream out(tmp);
        if (!out.is_open()) return false;
        out << doc.dump(2);
    }
    if (std::rename(tmp.c_str(), path.c_str()) != 0) return false;
    return true;
}

/// Minimal structural checks so bad PUTs do not corrupt disk.
inline bool validate_put_body(const json& doc) {
    if (!doc.is_object()) return false;
    if (!doc.contains("agents") || !doc["agents"].is_array()) return false;
    for (const auto& a : doc["agents"]) {
        if (!a.is_object()) return false;
        if (!a.contains("name") || !a["name"].is_string()) return false;
    }
    if (doc.contains("coordinator")) {
        if (!doc["coordinator"].is_object()) return false;
    }
    return true;
}

} // namespace config_svc
