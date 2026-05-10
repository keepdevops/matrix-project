#pragma once

#include <string>

namespace matrix_http {

/// Trim trailing `/` and spaces for HTTP base URLs.
inline void trim_http_base(std::string& s) {
    while (!s.empty() && (s.back() == '/' || s.back() == ' '))
        s.pop_back();
}

/// Parses `http://host:port` or `http://host:port/` (HTTPS accepted but coordinator client uses plain HTTP only).
inline bool parse_http_host_port(const std::string& base, std::string& host, int& port) {
    std::string b = base;
    trim_http_base(b);
    if (b.size() > 7 && b.compare(0, 7, "http://") == 0)
        b = b.substr(7);
    else if (b.size() > 8 && b.compare(0, 8, "https://") == 0)
        b = b.substr(8);
    else
        return false;
    const auto colon = b.find(':');
    if (colon == std::string::npos) return false;
    host = b.substr(0, colon);
    try {
        port = std::stoi(b.substr(colon + 1));
    } catch (...) {
        return false;
    }
    return !host.empty() && port > 0 && port <= 65535;
}

}  // namespace matrix_http
