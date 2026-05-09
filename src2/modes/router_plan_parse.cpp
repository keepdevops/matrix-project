#include "router_plan_parse.h"

#include <algorithm>
#include <iostream>
#include <regex>
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

}  // namespace router_plan
