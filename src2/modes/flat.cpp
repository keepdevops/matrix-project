#include "mode.h"
#include "../agent_client.h"

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

    std::vector<std::future<std::pair<std::string, std::string>>> futures;
    for (const auto& agent : ctx.agents) {
        const std::string& prompt = ctx.user_prompt;
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
        {"meta", json::object()}
    };
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
