#pragma once

#include "json.hpp"
#include <string>

using json = nlohmann::json;

/// Read full file as string (filesystem I/O only; no httplib).
std::string proxy_read_file_text(const std::string& path);

/// Last n non-empty lines as JSON array of strings (no httplib).
json proxy_tail_log_lines(const std::string& path, int n);
