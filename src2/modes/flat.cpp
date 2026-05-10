#include "mode.h"
#include "../agent_client.h"
#include "../mode_module.h"

#include <future>
#include <iostream>
#include <utility>

using json = nlohmann::json;

namespace {

// Parallel broadcast: every agent receives the same user prompt.
json run_flat(const ModeContext& ctx) {
    std::cout << "🔀 [flat] broadcasting to " << ctx.agents.size()
              << " agent(s) in parallel..." << std::endl;

    json agent_outputs = json::object();
    json meta = mode_module::module_meta("flat", ctx.mode_config);
    const std::string variant_policy = mode_module::option_string(
        ctx.mode_config, "variant_policy", "standard");
    meta["variant_policy"] = variant_policy;
    json participants = json::array();

    std::vector<std::future<std::pair<std::string, std::string>>> futures;
    for (size_t i = 0; i < ctx.agents.size(); ++i) {
        const Agent agent = ctx.agents[i];
        participants.push_back(agent.name);
        const std::string prompt = mode_module::flat_prompt_for_agent(
            ctx.user_prompt, agent, variant_policy, i, ctx.agents.size());
        futures.push_back(std::async(std::launch::async, [prompt, agent]() {
            return std::make_pair(agent.name, call_agent(agent, prompt));
        }));
    }
    for (auto& fut : futures) {
        auto pair = fut.get();
        agent_outputs[pair.first] = pair.second;
    }

    json envelope = {
        {"mode", "flat"},
        {"agents", agent_outputs},
        {"final", nullptr},
        {"meta", meta}
    };
    envelope["meta"]["participants"] = participants;
    return envelope;
}

struct Register {
    Register() {
        modes::register_mode({
            "flat",
            "Broadcast the prompt to every agent in parallel; no reducer.",
            run_flat
        });
    }
} _reg;

} // namespace
