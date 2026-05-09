#include "router_selected_parse.h"

std::vector<std::string> parse_router_selected_agents(const std::string& raw,
        int max_select,
        const std::unordered_set<std::string>& valid_names,
        const std::string& classifier_name) {
    std::vector<std::string> picked;
    auto pos = raw.find("SELECTED:");
    if (pos == std::string::npos) return picked;
    std::string tail = raw.substr(pos + 9);
    auto eol = tail.find('\n');
    if (eol != std::string::npos) tail = tail.substr(0, eol);
    std::string token;
    for (char c : tail + ',') {
        if (c == ',') {
            while (!token.empty() && (token.front() == ' ' || token.front() == '\t')) token.erase(token.begin());
            while (!token.empty()
                && (token.back() == ' ' || token.back() == '\t' || token.back() == '.'))
                token.pop_back();
            if (!token.empty() && valid_names.count(token) && token != classifier_name) {
                picked.push_back(token);
                if ((int)picked.size() >= max_select) break;
            }
            token.clear();
        } else {
            token += c;
        }
    }
    return picked;
}
