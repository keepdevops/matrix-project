#include "backend_router.h"
#include "inference_backend.h"

#include <cassert>
#include <cstdlib>
#include <iostream>
#include <string>

static Agent coding_llama() {
    Agent a;
    a.name = "programmer";
    a.engine = "llama";
    a.backend = "llama";
    a.model = "models/code.gguf";
    a.tags = {"coding"};
    return a;
}

static Agent mlx_vision() {
    Agent a;
    a.name = "vision";
    a.engine = "mlx";
    a.backend = "mlx";
    a.model = "mlx-community/Vision-7B-4bit";
    a.tags = {"vision"};
    return a;
}

int main() {
    unsetenv("MATRIX_BACKEND_ROUTING");
    unsetenv("LLAMA_METAL_PRIORITY");

    nlohmann::json cfg = nlohmann::json::object();
    backend_router::configure_from_startup(cfg);
    assert(!backend_router::enabled());

    Agent legacy = coding_llama();
    auto d0 = backend_router::resolve(legacy);
    assert(d0.reason == "legacy_engine");
    assert(d0.backend == BackendId::LlamaMetal);

    cfg["coordinator"]["backend_routing"]["enabled"] = true;
    backend_router::configure_from_startup(cfg);
    assert(backend_router::enabled());

    RoutingContext flat_ctx{"flat", false, 0.0};
    backend_router::set_dispatch_context(flat_ctx);
    auto d_flat = backend_router::resolve(coding_llama());
    assert(d_flat.reason == "legacy_engine");
    backend_router::clear_dispatch_context();

    RoutingContext pipe_ctx{"pipeline", true, 0.0};
    backend_router::set_dispatch_context(pipe_ctx);
    auto d_pipe = backend_router::resolve(coding_llama());
    assert(d_pipe.backend == BackendId::LlamaMetal);
    assert(d_pipe.reason.find("sequential") != std::string::npos
           || d_pipe.reason.find("default_llama") != std::string::npos);

    Agent mlx = mlx_vision();
    mlx.inference_backend = "auto";
    auto d_mlx = backend_router::resolve(mlx);
    assert(d_mlx.backend == BackendId::PythonMlx);

    mlx.inference_backend = "llama_metal";
    auto d_bad = backend_router::resolve(mlx);
    assert(d_bad.used_fallback);

    backend_router::clear_dispatch_context();
    std::cout << "test_backend_selection: OK\n";
    return 0;
}
