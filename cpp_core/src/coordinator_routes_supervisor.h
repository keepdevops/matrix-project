#pragma once
// GET  /api/supervisor/audit — recent policy decisions
// DELETE /api/supervisor/audit — clear audit log

#include "coordinator_context.h"
#include "httplib.h"

inline void register_coordinator_routes_supervisor(httplib::Server& svr,
                                                    CoordinatorState& st) {
    svr.Get("/api/supervisor/audit",
            [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(st.supervisor_audit_mutex);
        res.set_content(st.supervisor_audit.dump(), "application/json");
    });

    svr.Delete("/api/supervisor/audit",
               [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(st.supervisor_audit_mutex);
        st.supervisor_audit = nlohmann::json::array();
        res.set_content("{\"cleared\":true}", "application/json");
    });
}
