#include "code_fence_normalize.h"

#include <cctype>
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

struct FenceBlock {
    std::string lang;
    std::string content;
};

static std::string trim_copy(const std::string& s) {
    size_t a = 0;
    while (a < s.size() && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    size_t b = s.size();
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

static std::string parse_lang_token(const std::string& info_line) {
    std::string lang;
    size_t i = 0;
    while (i < info_line.size()) {
        while (i < info_line.size() && std::isspace(static_cast<unsigned char>(info_line[i]))) ++i;
        size_t j = i;
        while (j < info_line.size() && !std::isspace(static_cast<unsigned char>(info_line[j]))) ++j;
        if (j > i) {
            std::string tok = info_line.substr(i, j - i);
            if (tok.rfind("filename=", 0) == 0) {
                i = j;
                continue;
            }
            if (lang.empty()) lang = tok;
        }
        i = j;
    }
    return lang.empty() ? "text" : lang;
}

static std::vector<FenceBlock> extract_fences(const std::string& raw) {
    std::vector<FenceBlock> out;
    size_t pos = 0;
    const size_t kMin = 10;
    while (pos < raw.size()) {
        size_t open = raw.find("```", pos);
        if (open == std::string::npos) break;
        size_t info_start = open + 3;
        size_t nl = raw.find('\n', info_start);
        if (nl == std::string::npos) break;
        std::string info = raw.substr(info_start, nl - info_start);
        std::string lang = parse_lang_token(info);
        size_t content_start = nl + 1;
        size_t close = raw.find("```", content_start);
        if (close == std::string::npos) break;
        std::string content = trim_copy(raw.substr(content_start, close - content_start));
        if (content.size() >= kMin) {
            out.push_back({lang, content});
        }
        pos = close + 3;
    }
    return out;
}

}  // namespace

bool is_code_history_agent(const std::string& agent_name) {
    return code_agents().count(agent_name) > 0;
}

std::string normalize_for_history(const std::string& raw) {
    auto blocks = extract_fences(raw);
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
