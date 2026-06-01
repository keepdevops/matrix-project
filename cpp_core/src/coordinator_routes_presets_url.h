#pragma once
// Inline url_decode + GET/DELETE preset routes — included only by coordinator_routes_presets.cpp.

#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

namespace presets_url {

inline std::string decode(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '%' && i + 2 < s.size()) {
            char hex[3] = {s[i+1], s[i+2], '\0'};
            char* end;
            long v = std::strtol(hex, &end, 16);
            if (end == hex + 2) { out += static_cast<char>(v); i += 2; continue; }
        }
        out += (s[i] == '+') ? ' ' : s[i];
    }
    return out;
}

inline void register_get_delete_routes(httplib::Server& svr, CoordinatorState& st) {
    svr.Get("/api/presets", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(st.presets_mutex);
        res.set_content(st.presets.dump(), "application/json");
    });

    svr.Delete(R"(/api/presets/([^/]+))",
               [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = decode(req.matches[1]);
        bool removed = false;
        { std::lock_guard<std::mutex> lk(st.presets_mutex);
          removed = st.presets.erase(name) > 0; }
        if (removed) {
            std::lock_guard<std::mutex> lk(st.modes_config_mutex);
            coordinator_persist_modes_locked(st);
            std::cout << "🗑️  [presets] removed '" << name << "'" << std::endl;
        }
        res.set_content(json({{"name",name},{"removed",removed}}).dump(), "application/json");
    });
}

} // namespace presets_url
