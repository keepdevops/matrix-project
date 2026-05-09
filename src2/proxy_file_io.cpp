#include "proxy_file_io.h"

#include <fstream>
#include <stdexcept>
#include <iterator>
#include <vector>

std::string proxy_read_file_text(const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) throw std::runtime_error("Cannot read: " + path);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}

json proxy_tail_log_lines(const std::string& path, int n) {
    json lines = json::array();
    std::ifstream f(path);
    if (!f.is_open()) {
        lines.push_back("(file not found: " + path + ")");
        return lines;
    }
    std::vector<std::string> all;
    for (std::string l; std::getline(f, l);)
        if (!l.empty()) all.push_back(l);
    int start = (int)all.size() > n ? (int)all.size() - n : 0;
    for (int i = start; i < (int)all.size(); ++i) lines.push_back(all[i]);
    return lines;
}
