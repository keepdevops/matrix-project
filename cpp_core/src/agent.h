#pragma once

#include <string>
#include <vector>

struct Agent {
    std::string name;
    int port;
    int read_timeout_secs;
    int max_tokens;
    std::string system_prompt;
    std::string description;
    std::vector<std::string> tags; // e.g. {"planning"}, {"coding"}, {"review"}
    std::string backend;
    std::string engine; // "llama" (default), "mlx", or "docker"
    std::string model;  // model ID — sent in request body for docker/vllm

    // Speculative decoding config (llama-server only). The coordinator does
    // not act on these directly — they are recorded so the launch script can
    // pass --model-draft / --draft-max when starting the agent's server, and
    // so /api/agents reports them. Empty draft_model = no speculative decode.
    std::string draft_model;
    int draft_max = 0;

    /// Deployed model context length from swarm-config `context` (inference window).
    int context_window = 8192;

    /// Max simultaneous in-flight requests to this agent's port.
    /// 0 = unlimited (default for llama/vllm).
    /// 1 = serialized (default for mlx, which cannot handle concurrent requests).
    /// >1 = counted semaphore (useful for vllm with known concurrency limits).
    int max_concurrency = 0;
};
