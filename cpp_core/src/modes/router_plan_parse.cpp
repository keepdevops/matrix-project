#include "router_plan_parse.h"
#include "router_plan_parse_impl.h"

#include <algorithm>
#include <regex>
#include <stdexcept>

namespace router_plan {

std::vector<std::string> as_string_vec(const nlohmann::json& j) {
    std::vector<std::string> out;
    if (!j.is_array()) return out;
    for (const auto& x : j)
        if (x.is_string()) out.push_back(x.get<std::string>());
    return out;
}

std::vector<std::string> extract_names_from_plan(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set) {
    auto selected = plan_parse_impl::parse_selected_line(raw, choice_set);
    if (!selected.empty()) return selected;
    return plan_parse_impl::extract_by_mention(raw, choice_set);
}

std::vector<TokenDirective> parse_set_tokens_directives(const std::string& raw) {
    std::vector<TokenDirective> out;
    std::regex line_re(R"((?:^|\n)[^\n]*\bSET_TOKENS\s*:\s*([^\n]+))", std::regex::icase);
    std::regex kv_re(R"(([A-Za-z_]+)\s*=\s*(\d+))");
    for (auto it = std::sregex_iterator(raw.begin(), raw.end(), line_re);
         it != std::sregex_iterator(); ++it) {
        std::string rest = (*it)[1].str();
        std::regex name_re(R"(^\s*([A-Za-z][A-Za-z0-9_-]*))");
        std::smatch nm;
        if (!std::regex_search(rest, nm, name_re)) continue;
        TokenDirective d;
        d.agent = nm[1].str();
        for (auto kv = std::sregex_iterator(rest.begin(), rest.end(), kv_re);
             kv != std::sregex_iterator(); ++kv) {
            const std::string key = (*kv)[1].str();
            int val = 0;
            try { val = std::stoi((*kv)[2].str()); } catch (...) { continue; }
            if (key == "max_tokens")             d.max_tokens        = val;
            else if (key == "read_timeout_secs") d.read_timeout_secs = val;
        }
        if (d.max_tokens > 0 || d.read_timeout_secs > 0) out.push_back(d);
    }
    return out;
}

int apply_token_directives(std::vector<Agent>& agents,
                           const std::vector<TokenDirective>& directives) {
    int applied = 0;
    for (const auto& d : directives) {
        for (auto& a : agents) {
            if (a.name != d.agent) continue;
            if (d.max_tokens >= 64 && d.max_tokens <= 131072) { a.max_tokens = d.max_tokens; ++applied; }
            if (d.read_timeout_secs >= 30 && d.read_timeout_secs <= 7200) a.read_timeout_secs = d.read_timeout_secs;
            break;
        }
    }
    return applied;
}

}  // namespace router_plan
