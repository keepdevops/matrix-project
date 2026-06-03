#include "backend_router.h"

#include <cassert>
#include <cstdlib>
#include <iostream>

int main() {
    unsetenv("MATRIX_BACKEND_ROUTING");
    nlohmann::json cfg{{"coordinator", {{"backend_routing", {{"enabled", true},
                                                              {"llama_metal_priority", "high"}}}}}};
    backend_router::configure_from_startup(cfg);

    RoutingContext ctx{"pipeline", true, 0.85};
    backend_router::set_dispatch_context(ctx);

    Agent a;
    a.name = "architect";
    a.engine = "llama";
    a.model = "m.gguf";
    a.inference_backend = "auto";

    auto d = backend_router::resolve(a);
    assert(d.backend == BackendId::LlamaMetal);
    assert(d.reason == "kv_pressure_llama_prefix_cache");

    backend_router::record_decision(a.name, d);
    auto snap = backend_router::snapshot_decisions();
    assert(snap.contains("architect"));
    assert(snap["architect"]["backend"] == "llama_metal");

    backend_router::clear_dispatch_context();
    std::cout << "test_backend_router: OK\n";
    return 0;
}
