#include "coordinator_context.h"
#include "coordinator_routes.h"
#include "coordinator_startup.h"
#include "telemetry.h"

#include "httplib.h"

#include <cstdlib>
#include <iostream>

int main(int argc, char* argv[]) {
    CoordinatorState state;
    if (!coordinator_startup(state, argc, argv)) return 1;

    httplib::Server svr;

    {
        auto& boot = telemetry::Registry::instance().counter(
            "coordinator_boot_total", "Coordinator process starts.");
        boot.Increment();
        auto& loaded = telemetry::Registry::instance().gauge(
            "coordinator_agents_loaded", "Agents loaded from the active swarm config.");
        loaded.Set(static_cast<double>(state.agents.size()));
    }

    svr.Get("/metrics", [](const httplib::Request&, httplib::Response& res) {
        res.set_content(telemetry::Registry::instance().render(),
                        "text/plain; version=0.0.4");
    });
    svr.set_pre_routing_handler(
        [](const httplib::Request& req, httplib::Response&) {
            telemetry::Registry::instance()
                .counter("coordinator_http_requests_total",
                         "Coordinator HTTP requests handled.",
                         {{"method", req.method}})
                .Increment();
            return httplib::Server::HandlerResponse::Unhandled;
        });

    register_coordinator_routes(svr, state);

    std::cout << "🌐 Swarm Matrix coordinator ONLINE (port 8000)" << std::endl;
    int listen_port = 8000;
    if (const char* p = std::getenv("MATRIX_COORDINATOR_PORT")) {
        try { listen_port = std::stoi(p); } catch (...) {}
    }
    std::cout << "🌐 listening on 0.0.0.0:" << listen_port << std::endl;
    svr.listen("0.0.0.0", listen_port);
    return 0;
}
