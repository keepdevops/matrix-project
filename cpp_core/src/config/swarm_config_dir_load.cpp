#include "swarm_config_dir_load.h"

#include "path_expand.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <vector>

namespace coordinator_config {

namespace fs = std::filesystem;
using nlohmann::json;

bool is_directory_path(const std::string& path) {
    std::error_code ec;
    return fs::is_directory(path, ec);
}

static bool read_json_file(const fs::path& p, json& out) {
    std::ifstream in(p);
    if (!in.is_open()) {
        std::cerr << "❌ cannot open " << p << std::endl;
        return false;
    }
    try {
        out = json::parse(in);
        return true;
    } catch (const std::exception& exc) {
        std::cerr << "❌ JSON parse failed for " << p << ": " << exc.what() << std::endl;
        return false;
    }
}

bool load_swarm_config_from_dir(const std::string& path, json& out) {
    fs::path root(path);
    fs::path agents_dir = root / "agents";
    fs::path coord_file = root / "coordinator.json";

    if (!fs::is_directory(agents_dir)) {
        std::cerr << "❌ agents directory missing: " << agents_dir << std::endl;
        return false;
    }

    std::vector<fs::path> agent_files;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(agents_dir, ec)) {
        if (!entry.is_regular_file()) continue;
        if (entry.path().extension() != ".json") continue;
        agent_files.push_back(entry.path());
    }
    if (ec) {
        std::cerr << "❌ scanning " << agents_dir << ": " << ec.message() << std::endl;
        return false;
    }
    if (agent_files.empty()) {
        std::cerr << "❌ no *.json under " << agents_dir << std::endl;
        return false;
    }
    std::sort(agent_files.begin(), agent_files.end());

    json agents = json::array();
    for (const auto& p : agent_files) {
        json one;
        if (!read_json_file(p, one)) return false;
        // The split files carry an `agent_id` slug; the legacy C++ schema
        // keys on `name`. We preserve agent_id as metadata but ensure name
        // exists (it always should — migrate_swarm_config.py kept it).
        if (!one.contains("name") || !one["name"].is_string()) {
            std::cerr << "❌ " << p << " missing 'name' field" << std::endl;
            return false;
        }
        // Expand ${MATRIX_MODEL_DIR} and rewrite the legacy /Users/Shared
        // prefix so configs are portable across machines.
        if (one.contains("model") && one["model"].is_string()) {
            one["model"] = expand_model_path(one["model"].get<std::string>());
        }
        if (one.contains("draft_model") && one["draft_model"].is_string()) {
            one["draft_model"] = expand_model_path(one["draft_model"].get<std::string>());
        }
        agents.push_back(std::move(one));
    }

    out = json::object();
    out["agents"] = std::move(agents);

    if (fs::exists(coord_file)) {
        json coord_doc;
        if (!read_json_file(coord_file, coord_doc)) return false;
        if (coord_doc.contains("coordinator")) out["coordinator"] = coord_doc["coordinator"];
        if (coord_doc.contains("ui"))          out["ui"]          = coord_doc["ui"];
        if (coord_doc.contains("rag"))         out["rag"]         = coord_doc["rag"];
    } else {
        std::cerr << "ℹ️  no " << coord_file << " — running with built-in coordinator defaults"
                  << std::endl;
    }

    return true;
}

}  // namespace coordinator_config
