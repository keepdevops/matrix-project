#include "coordinator_context.h"
#include "swarm_config_store.h"

#include <fstream>
#include <iostream>

using json = nlohmann::json;

void coordinator_load_history(CoordinatorState& st) {
    std::ifstream f(st.history_path);
    if (!f.is_open()) return;
    try {
        json arr = json::parse(f);
        if (arr.is_array()) st.history = arr.get<std::vector<json>>();
    } catch (const std::exception& e) {
        std::cerr << "❌ Failed to parse history: " << e.what() << std::endl;
    }
}

void coordinator_save_history(CoordinatorState& st) {
    std::ofstream f(st.history_path);
    if (!f.is_open()) {
        std::cerr << "❌ Failed to open history file for writing: " << st.history_path << std::endl;
        return;
    }
    f << json(st.history).dump(2);
}

bool coordinator_persist_modes_locked(CoordinatorState& st) {
    return swarm_mirror_modes_presets(st.swarm_paths(), st.modes_config,
        st.presets_mutex, st.presets);
}
