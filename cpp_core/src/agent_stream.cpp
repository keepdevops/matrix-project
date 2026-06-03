#include "agent_stream.h"
#include "agent_stream_llama.h"

namespace agent_stream {

std::string stream_agent(const Agent& agent,
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel,
                         const std::string& session_id) {
    if (agent.engine == "llama")
        return stream_llama(agent, system_prompt, prompt, std::move(on_chunk), cancel);
    // MS-148: true SSE streaming for MLX; MS-149: session_id enables history injection
    return stream_mlx(agent, system_prompt, prompt, std::move(on_chunk), cancel, session_id);
}

} // namespace agent_stream
