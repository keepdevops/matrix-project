#include "router_plan_parse.h"

#include <algorithm>
#include <iostream>
#include <regex>
#include <stdexcept>
#include <unordered_map>
#include <utility>

namespace router_plan {

std::vector<std::string> as_string_vec(const nlohmann::json& j) {
    std::vector<std::string> out;
    if (!j.is_array()) return out;
    for (const auto& x : j) {
        if (x.is_string()) out.push_back(x.get<std::string>());
    }
    return out;
}

std::vector<std::string> parse_selected_line(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set) {
    std::vector<std::string> out;
    std::regex line_re(R"((?:^|\n)[^\n]*\bSELECTED\s*:\s*([^\n]+))",
                       std::regex::icase);
    std::smatch m;
    if (!std::regex_search(raw, m, line_re)) return out;

    std::string list = m[1].str();
    std::unordered_set<std::string> choice_lower;
    std::unordered_map<std::string, std::string> lower_to_canonical;
    for (const auto& n : choice_set) {
        std::string l = n;
        std::transform(l.begin(), l.end(), l.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        choice_lower.insert(l);
        lower_to_canonical[l] = n;
    }

    std::unordered_set<std::string> seen;
    std::regex tok_re(R"([A-Za-z][A-Za-z0-9_-]*)");
    auto begin = std::sregex_iterator(list.begin(), list.end(), tok_re);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        std::string tok = it->str();
        std::transform(tok.begin(), tok.end(), tok.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        if (!choice_lower.count(tok)) continue;
        if (seen.insert(tok).second) out.push_back(lower_to_canonical[tok]);
    }
    return out;
}

std::vector<std::string> extract_names_from_plan(
    const std::string& raw,
    const std::unordered_set<std::string>& choice_set) {
    auto selected = parse_selected_line(raw, choice_set);
    if (!selected.empty()) return selected;

    std::string lower = raw;
    std::transform(lower.begin(), lower.end(), lower.begin(),
                   [](unsigned char c) { return std::tolower(c); });

    std::vector<std::pair<size_t, std::string>> hits;
    hits.reserve(choice_set.size());
    for (const auto& name : choice_set) {
        std::string pat = name;
        std::transform(pat.begin(), pat.end(), pat.begin(),
                       [](unsigned char c) { return std::tolower(c); });
        try {
            std::regex re("\\b" + pat + "\\b");
            std::smatch m;
            if (std::regex_search(lower, m, re)) {
                hits.emplace_back((size_t)m.position(0), name);
            }
        } catch (const std::exception& e) {
            std::cerr << "⚠️  [router] regex error for '" << name << "': "
                      << e.what() << std::endl;
        }
    }
    std::sort(hits.begin(), hits.end(),
              [](const auto& a, const auto& b) { return a.first < b.first; });

    std::vector<std::string> out;
    out.reserve(hits.size());
    for (const auto& h : hits) out.push_back(h.second);
    return out;
}

// SET_TOKENS: <agent> max_tokens=<n> [read_timeout_secs=<n>]
// One directive per line; extra fields or unknown agents are silently ignored
// by the caller. Values are bounds-checked before application.
std::vector<TokenDirective> parse_set_tokens_directives(const std::string& raw) {
    std::vector<TokenDirective> out;
    // Match a SET_TOKENS: line anywhere in the response.
    std::regex line_re(R"((?:^|\n)[^\n]*\bSET_TOKENS\s*:\s*([^\n]+))",
                       std::regex::icase);
    std::regex kv_re(R"(([A-Za-z_]+)\s*=\s*(\d+))");
    auto line_begin = std::sregex_iterator(raw.begin(), raw.end(), line_re);
    for (auto it = line_begin; it != std::sregex_iterator(); ++it) {
        std::string rest = (*it)[1].str();
        // First token is the agent name (may contain hyphens/underscores).
        std::regex name_re(R"(^\s*([A-Za-z][A-Za-z0-9_-]*))");
        std::smatch nm;
        if (!std::regex_search(rest, nm, name_re)) continue;
        TokenDirective d;
        d.agent = nm[1].str();
        // Parse key=value pairs following the agent name.
        auto kv_begin = std::sregex_iterator(rest.begin(), rest.end(), kv_re);
        for (auto kv = kv_begin; kv != std::sregex_iterator(); ++kv) {
            const std::string key = (*kv)[1].str();
            int val = 0;
            try { val = std::stoi((*kv)[2].str()); } catch (...) { continue; }
            if (key == "max_tokens")        d.max_tokens        = val;
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
            if (d.max_tokens >= 64 && d.max_tokens <= 131072) {
                a.max_tokens = d.max_tokens;
                ++applied;
            }
            if (d.read_timeout_secs >= 30 && d.read_timeout_secs <= 7200) {
                a.read_timeout_secs = d.read_timeout_secs;
            }
            break;
        }
    }
    return applied;
}

}  // namespace router_plan
