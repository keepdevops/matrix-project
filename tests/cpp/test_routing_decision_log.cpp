#include "backend_router.h"

#include <cassert>
#include <iostream>

int main() {
    nlohmann::json cfg{{"coordinator", {{"backend_routing", {{"enabled", true}}}}}};
    backend_router::configure_from_startup(cfg);
    backend_router::set_dispatch_context({"router", true, 0.0});

    Agent a;
    a.name = "reviewer";
    a.engine = "llama";
    a.inference_backend = "llama_metal";

    auto d = backend_router::make_decision(BackendId::LlamaMetal, "agent_override");
    backend_router::record_decision(a.name, d);
    backend_router::record_decision(a.name,
        backend_router::make_decision(BackendId::PythonMlx, "load_failure_fallback", true));

    auto log = backend_router::decision_log_entries();
    assert(log.is_array());
    assert(log.size() >= 2);
    assert(log.back()["reason"] == "load_failure_fallback");
    assert(log.back()["fallback"].get<bool>());

    backend_router::clear_dispatch_context();
    std::cout << "test_routing_decision_log: OK\n";
    return 0;
}
