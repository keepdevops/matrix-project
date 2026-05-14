#pragma once

#include <string>
#include <vector>

struct PortGroup {
    std::string model, backend;
    int context = 0, gpu_layers = 0;
    float gpu_mem_util = 0.75f;
    std::vector<std::string> names;
    std::string draft_model;
    int draft_max = 0;
};

inline constexpr int PROXY_CONFIGURE_DOCKER_PORT = 12434;
