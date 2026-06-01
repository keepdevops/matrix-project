#include "proxy_routes.h"
#include "proxy_routes_local.h"
#include "proxy_routes_convert.h"
#include "proxy_routes_orchestrate.h"

#include "httplib.h"

void register_proxy_routes(httplib::Server& svr, const std::string& proj_root) {
    svr.Options(R"(/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        res.set_header("Access-Control-Allow-Headers", "Content-Type");
        res.status = 204;
    });

    register_proxy_routes_local(svr, proj_root);
    register_proxy_orchestrate_routes(svr);
    register_convert_routes(svr, proj_root);
    register_proxy_coordinator_forward(svr);
}
