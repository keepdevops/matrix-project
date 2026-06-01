#include "code_fence_normalize.h"
#include "code_fence_parse.h"

#include <unordered_set>

namespace code_fence {

namespace {

const std::unordered_set<std::string>& code_agents() {
    static const std::unordered_set<std::string> k = {"programmer", "frontend"};
    return k;
}

const std::unordered_set<std::string>& reserved_entry_keys() {
    static const std::unordered_set<std::string> k = {
        "prompt", "temperature", "timestamp",
        "_final", "_mode", "_session_id", "_run_id",
    };
    return k;
}

}  // namespace

bool is_code_history_agent(const std::string& agent_name) {
    return code_agents().count(agent_name) > 0;
}

std::string normalize_for_history(const std::string& raw) {
    auto blocks = impl::extract_fences(raw);
    if (blocks.empty()) return raw;
    std::string out;
    for (size_t i = 0; i < blocks.size(); ++i) {
        if (i > 0) out += "\n\n";
        out += "```";
        out += blocks[i].lang;
        out += "\n";
        out += blocks[i].content;
        out += "\n```";
    }
    return out;
}

void normalize_agents_in_entry(nlohmann::json& entry) {
    if (!entry.is_object()) return;
    const auto& reserved = reserved_entry_keys();
    for (auto it = entry.begin(); it != entry.end(); ++it) {
        if (!it.value().is_string()) continue;
        const std::string& key = it.key();
        if (reserved.count(key) > 0) continue;
        if (!is_code_history_agent(key)) continue;
        it.value() = normalize_for_history(it.value().get<std::string>());
    }
}

}  // namespace code_fence
