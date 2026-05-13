#pragma once
#include <map>
#include <string>
#include <vector>

// One inference server endpoint shared by 1..N agents (parallel slots).
struct PortGroup {
    std::string model, backend;
    int context = 0, gpu_layers = 0;
    float gpu_mem_util = 0.75f;
    std::vector<std::string> names;
};

static const int DOCKER_PORT = 12434;

// Poll /health (llama) or /v1/models (mlx/vllm/docker*) on each port every 2 s
// until all return 200 or `timeout_secs` elapses. Returns the still-unhealthy
// ports (empty on full success).
std::vector<int> wait_for_health(
    const std::map<int, PortGroup>& pgs,
    int timeout_secs);

// Pre-flight check for the "docker" backend (Docker Desktop Model Runner).
// Probes port 12434 with a short timeout and verifies the model is already loaded.
// Returns "" on success, human-readable error string on failure.
std::string check_docker_model_runner(const std::string& model);
