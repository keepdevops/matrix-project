#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "rag_client.h"
#include "rag_config.h"

void register_coordinator_routes_rag_health(httplib::Server& svr, CoordinatorState& st) {
    // GET /api/rag/health — liveness probe for the pgvector backing store.
    // Uses the same DSN/connection rag::retrieve() uses, so the UI sees what
    // the coordinator can actually reach.
    svr.Get("/api/rag/health",
            [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        rag::Settings s = rag::settings_from_config(st.startup_config);
        json out = {
            {"enabled", s.enabled},
            {"embedder", s.embedder},
            {"top_k", s.top_k},
            {"min_score", s.min_score},
        };
        std::string err;
        bool ok = rag::health_check(s, &err);
        out["ok"] = ok;
        if (!ok && !err.empty()) out["error"] = err;
        res.set_content(out.dump(), "application/json");
    });
}
