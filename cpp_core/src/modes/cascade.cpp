#include "mode.h"
#include "cascade_exec.h"
#include "../mode_module.h"

#include <iostream>
#include <string>

using json = nlohmann::json;

namespace {

json run_cascade(const ModeContext& ctx) {
    std::cout << "🌊 [cascade] broadcasting to " << ctx.agents.size()
              << " agent(s) in parallel..." << std::endl;

    std::string synthesizer_name;
    if (ctx.mode_config.contains("synthesizer")
        && ctx.mode_config["synthesizer"].is_string())
        synthesizer_name = ctx.mode_config["synthesizer"].get<std::string>();

    json meta = mode_module::module_meta("cascade", ctx.mode_config);
    const std::string synthesis_policy = mode_module::option_string(
        ctx.mode_config, "synthesis_policy", "summary");
    meta["synthesis_policy"] = synthesis_policy;

    auto br = cascade_exec::run_parallel_broadcast(ctx, synthesizer_name);

    meta["participants"] = br.participants;
    if (!br.errors.empty()) meta["errors"] = br.errors;
    json excluded = json::array();
    for (const auto& name : br.participants) {
        bool ok = std::find(br.healthy.begin(), br.healthy.end(), name) != br.healthy.end();
        if (!ok) excluded.push_back(name);
    }
    if (!excluded.empty()) meta["excluded"] = excluded;

    std::string final_output = cascade_exec::run_synthesizer(
        ctx, synthesizer_name, synthesis_policy, br, br.agent_outputs, meta);

    return json{
        {"mode", "cascade"},
        {"agents", br.agent_outputs},
        {"final", final_output.empty() ? json(nullptr) : json(final_output)},
        {"meta", meta}
    };
}

struct Register {
    Register() {
        modes::register_mode({
            "cascade",
            "Mixture-of-agents — parallel broadcast then a synthesizer reduces all responses into one final answer.",
            run_cascade
        });
    }
} _reg;

} // namespace
