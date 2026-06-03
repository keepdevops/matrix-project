#include "inference_backend.h"

#include <cassert>
#include <iostream>
#include <string>

static Agent llama_agent() {
    Agent a;
    a.name = "architect";
    a.engine = "llama";
    a.backend = "llama";
    a.model = "/models/foo.gguf";
    return a;
}

static Agent mlx_agent() {
    Agent a;
    a.name = "vision";
    a.engine = "mlx";
    a.backend = "mlx";
    a.model = "mlx-community/Llama-3.2-3B-4bit";
    return a;
}

int main() {
    bool ok = false;
    assert(inference_backend::from_name("llama_metal", &ok) == BackendId::LlamaMetal);
    assert(ok);
    assert(inference_backend::from_name("python_mlx", &ok) == BackendId::PythonMlx);
    assert(ok);
    assert(inference_backend::from_name("unknown", &ok) == BackendId::LlamaMetal);
    assert(!ok);

    assert(std::string(inference_backend::id_name(BackendId::LlamaMetal)) == "llama_metal");
    assert(std::string(inference_backend::id_name(BackendId::PythonMlx)) == "python_mlx");

    assert(inference_backend::supports(llama_agent(), BackendId::LlamaMetal));
    assert(!inference_backend::supports(llama_agent(), BackendId::PythonMlx));
    assert(inference_backend::supports(mlx_agent(), BackendId::PythonMlx));
    assert(!inference_backend::supports(mlx_agent(), BackendId::LlamaMetal));

    std::cout << "test_backend_registry: OK\n";
    return 0;
}
