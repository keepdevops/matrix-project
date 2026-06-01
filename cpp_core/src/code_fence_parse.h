#pragma once
// Inline fence-parsing helpers — included only by code_fence_normalize.cpp.

#include <cctype>
#include <string>
#include <vector>

namespace code_fence { namespace impl {

struct FenceBlock {
    std::string lang;
    std::string content;
};

inline std::string trim_copy(const std::string& s) {
    size_t a = 0;
    while (a < s.size() && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    size_t b = s.size();
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

inline std::string parse_lang_token(const std::string& info_line) {
    std::string lang;
    size_t i = 0;
    while (i < info_line.size()) {
        while (i < info_line.size() && std::isspace(static_cast<unsigned char>(info_line[i]))) ++i;
        size_t j = i;
        while (j < info_line.size() && !std::isspace(static_cast<unsigned char>(info_line[j]))) ++j;
        if (j > i) {
            std::string tok = info_line.substr(i, j - i);
            if (tok.rfind("filename=", 0) == 0) { i = j; continue; }
            if (lang.empty()) lang = tok;
        }
        i = j;
    }
    return lang.empty() ? "text" : lang;
}

inline std::vector<FenceBlock> extract_fences(const std::string& raw) {
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
        if (content.size() >= kMin) out.push_back({lang, content});
        pos = close + 3;
    }
    return out;
}

}} // namespace code_fence::impl
