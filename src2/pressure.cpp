#include "pressure.h"

void register_pressure_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents) {
    svr.Get("/api/pressure", [&agents](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(snapshot_pressure(agents).dump(), "application/json");
    });
}
