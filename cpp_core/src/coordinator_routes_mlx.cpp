#ifdef MATRIX_MLX_NATIVE_COORD
#include "coordinator_routes_mlx.h"
#include "json.hpp"

using json = nlohmann::json;

namespace {

void cors(httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
}

// Returns 501 with a JSON body identifying the route and the MS issue that
// will implement it, so callers get actionable context rather than a blank 501.
void stub_501(httplib::Response& res, const char* route, const char* ms) {
    cors(res);
    json body = {
        {"error",  "not implemented"},
        {"route",  route},
        {"status", "stub — " + std::string(ms)},
    };
    res.status = 501;
    res.set_content(body.dump(), "application/json");
}

}  // namespace

void register_coordinator_routes_mlx(httplib::Server& svr, CoordinatorState& /*st*/) {
    // ── Submit (flat dispatch) — MS-133 ──────────────────────────────────────
    svr.Post("/api/mlx/submit", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/submit", "MS-133");
    });

    // ── SSE token stream — MS-136 ─────────────────────────────────────────────
    svr.Post("/api/mlx/stream", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/stream", "MS-136");
    });

    // ── Health + pressure — MS-134 ────────────────────────────────────────────
    svr.Get("/api/mlx/health", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/health", "MS-134");
    });

    svr.Get("/api/mlx/pressure", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/pressure", "MS-134");
    });

    // ── Agents + modes — MS-139 ───────────────────────────────────────────────
    svr.Get("/api/mlx/agents", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/agents", "MS-139");
    });

    svr.Get("/api/mlx/modes", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "GET /api/mlx/modes", "MS-139");
    });

    svr.Post("/api/mlx/modes/active", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/modes/active", "MS-139");
    });

    // ── Session clear — MS-140 ────────────────────────────────────────────────
    svr.Post("/api/mlx/session/clear", [](const httplib::Request&, httplib::Response& res) {
        stub_501(res, "POST /api/mlx/session/clear", "MS-140");
    });
}

#endif  // MATRIX_MLX_NATIVE_COORD
