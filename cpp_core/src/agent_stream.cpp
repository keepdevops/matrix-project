#include "agent_stream.h"
#include "agent_stream_llama.h"
#include "backend_router.h"

namespace agent_stream {

std::string stream_agent(const Agent& agent,
                         const std::string& system_prompt,
                         const std::string& prompt,
                         OnChunk on_chunk,
                         std::atomic<bool>* cancel,
                         const std::string& session_id) {
    const RoutingDecision routing = backend_router::resolve(agent);
    const Agent work = backend_router::materialize(agent, routing);
    if (backend_router::should_route(agent))
        backend_router::record_decision(agent.name, routing);

    if (routing.backend == BackendId::LlamaMetal)
        return stream_llama(work, system_prompt, prompt, std::move(on_chunk), cancel);
    return stream_mlx(work, system_prompt, prompt, std::move(on_chunk), cancel, session_id);
}

} // namespace agent_stream
