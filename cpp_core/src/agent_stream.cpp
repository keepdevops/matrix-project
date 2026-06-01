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
    return stream_mlx_oneshot(agent, system_prompt, prompt, std::move(on_chunk));
}

} // namespace agent_stream
