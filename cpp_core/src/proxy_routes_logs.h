#pragma once
// Inline logs route — included only by proxy_routes.cpp.

#include "proxy_file_io.h"
#include "httplib.h"
#include "json.hpp"

#include <algorithm>
#include <cctype>
#include <functional>
#include <set>
#include <sstream>
#include <string>
#include <unistd.h>

namespace proxy_logs {

using json = nlohmann::json;
using CorsFn = std::function<void(httplib::Response&)>;

inline void register_route(httplib::Server& svr, CorsFn cors, const std::string& proj_root) {
    svr.Get("/api/logs", [cors, proj_root](const httplib::Request& req, httplib::Response& res) {
        cors(res);
        std::string raw = req.has_param("ports") ? req.get_param_value("ports")
                        : req.has_param("port")  ? req.get_param_value("port") : "";
        if (raw.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"Query param ports required\"}", "application/json");
            return;
        }
        json logs = json::array();
        std::istringstream ss(raw);
        std::string tok;
        std::set<std::string> seen;
        while (std::getline(ss, tok, ',') && logs.size() < 10) {
            while (!tok.empty() && tok.front() == ' ') tok.erase(tok.begin());
            while (!tok.empty() && tok.back()  == ' ') tok.pop_back();
            if (tok.empty() || !std::all_of(tok.begin(), tok.end(), ::isdigit)) continue;
            if (!seen.insert(tok).second) continue;
            std::string lp = proj_root + "/agent_logs/" + tok + ".log";
            if (access(lp.c_str(), F_OK) != 0) lp = proj_root + "/logs/" + tok + ".log";
            logs.push_back({{"port", std::stoi(tok)}, {"lines", proxy_tail_log_lines(lp, 80)}});
        }
        res.set_content(json{{"logs", logs}}.dump(), "application/json");
    });
}

} // namespace proxy_logs
