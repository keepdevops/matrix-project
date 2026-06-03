#include "agent_stream.h"
#include "agent_stream_llama.h"

namespace agent_stream {

std::string stream_agent(const Agent& agent,
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel) {
    if (agent.engine == "llama")
        return stream_llama(agent, system_prompt, prompt, std::move(on_chunk), cancel);
    // MS-148: true SSE streaming for MLX; replaces blocking stream_mlx_oneshot
    return stream_mlx(agent, system_prompt, prompt, std::move(on_chunk), cancel);
}

} // namespace agent_stream
