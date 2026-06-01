#pragma once

#include <string>
#include <vector>

namespace rag {

bool parse_http_url(const std::string& url, std::string& host, int& port, std::string& path);
std::vector<double> mlx_embed(const std::string& embed_url, const std::string& query);

}  // namespace rag
