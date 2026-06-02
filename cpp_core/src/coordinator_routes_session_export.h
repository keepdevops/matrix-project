#pragma once
// GET /api/sessions/:session_id/export.md   — Markdown transcript download
// GET /api/sessions/:session_id/export.json — JSON array download

#include "coordinator_context.h"
#include "httplib.h"
#include "json.hpp"
#include <algorithm>
#include <chrono>
#include <ctime>
#include <iomanip>
#include <sstream>
#include <string>
#include <vector>

namespace session_export {

inline std::string iso_from_ms(long long ms) {
    std::time_t t = static_cast<std::time_t>(ms / 1000);
    std::tm tm{};
#ifdef _WIN32
    gmtime_s(&tm, &t);
#else
    gmtime_r(&t, &tm);
#endif
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

inline std::vector<nlohmann::json> entries_for_session(
    const std::vector<nlohmann::json>& history,
    const std::string& session_id)
{
    std::vector<nlohmann::json> out;
    for (const auto& e : history)
        if (e.value("_session_id", "") == session_id) out.push_back(e);
    std::sort(out.begin(), out.end(), [](const nlohmann::json& a, const nlohmann::json& b) {
        return a.value("timestamp", 0LL) < b.value("timestamp", 0LL);
    });
    return out;
}

inline std::string to_markdown(const std::string& session_id,
                                const std::vector<nlohmann::json>& entries) {
    std::ostringstream md;
    auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    md << "# Session: " << session_id << "\n"
       << "Exported: " << iso_from_ms(now_ms) << "\n\n";
    int turn = 0;
    for (const auto& e : entries) {
        ++turn;
        const std::string ts = iso_from_ms(e.value("timestamp", 0LL));
        md << "## Turn " << turn << " — " << ts << "\n\n"
           << "**You:** " << e.value("prompt", "") << "\n\n";
        std::string ans;
        if (e.contains("_final") && e["_final"].is_string())
            ans = e["_final"].get<std::string>();
        if (ans.empty()) {
            for (const auto& [k, v] : e.items()) {
                if (!k.empty() && k[0] != '_' && k != "prompt" && k != "temperature"
                    && k != "timestamp" && v.is_string() && !v.get<std::string>().empty()) {
                    ans = v.get<std::string>(); break;
                }
            }
        }
        md << "**Swarm:** " << ans << "\n\n---\n\n";
    }
    return md.str();
}

} // namespace session_export

inline void register_coordinator_routes_session_export(httplib::Server& svr,
                                                        CoordinatorState& st) {
    svr.Get(R"(/api/sessions/([^/]+)/export\.md)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.matches[1];
        std::vector<nlohmann::json> entries;
        {
            std::lock_guard<std::mutex> lk(st.history_mutex);
            entries = session_export::entries_for_session(st.history, sid);
        }
        if (entries.empty()) {
            res.status = 404;
            res.set_content("{\"error\":\"session not found or empty\"}", "application/json");
            return;
        }
        const std::string md = session_export::to_markdown(sid, entries);
        res.set_header("Content-Disposition",
                       "attachment; filename=\"session-" + sid.substr(0, 12) + ".md\"");
        res.set_content(md, "text/markdown; charset=utf-8");
    });

    svr.Get(R"(/api/sessions/([^/]+)/export\.json)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string sid = req.matches[1];
        nlohmann::json arr = nlohmann::json::array();
        {
            std::lock_guard<std::mutex> lk(st.history_mutex);
            for (const auto& e : session_export::entries_for_session(st.history, sid))
                arr.push_back(e);
        }
        if (arr.empty()) {
            res.status = 404;
            res.set_content("{\"error\":\"session not found or empty\"}", "application/json");
            return;
        }
        res.set_header("Content-Disposition",
                       "attachment; filename=\"session-" + sid.substr(0, 12) + ".json\"");
        res.set_content(arr.dump(2), "application/json");
    });
}
