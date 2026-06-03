#include "config/swarm_config_resolve.h"

#include <fstream>
#include <iostream>
#include <string>

namespace swarm_config_resolve {
namespace {

bool file_readable(const std::string& path) {
    std::ifstream f(path);
    return f.good();
}

}  // namespace

bool open_config_path(const std::string& requested, std::string& resolved_path) {
    static const char* kLocal = "swarm-config.json";
    static const char* kTemplate = "swarm-config.template.json";

    if (file_readable(requested)) {
        resolved_path = requested;
        return true;
    }
    std::cerr << "⚠️  Could not open swarm config: " << requested << std::endl;

    if (requested != kLocal && file_readable(kLocal)) {
        std::cerr << "   Using local " << kLocal << " instead." << std::endl;
        resolved_path = kLocal;
        return true;
    }
    if (file_readable(kTemplate)) {
        std::cerr << "   Using template " << kTemplate
                  << " (run scripts/setup-config.sh for a writable copy)." << std::endl;
        resolved_path = kTemplate;
        return true;
    }
    std::cerr << "❌ No swarm config found. Copy template: "
              << "bash scripts/setup-config.sh" << std::endl;
    return false;
}

}  // namespace swarm_config_resolve
