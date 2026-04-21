#pragma once

#include <string>

struct Agent {
    std::string name;
    int port;
    int read_timeout_secs;
    int max_tokens;
    std::string system_prompt;
    std::string backend;
    std::string engine; // "llama" (default), "mlx", or "docker"
    std::string model;  // model ID — sent in request body for docker/vllm
};
