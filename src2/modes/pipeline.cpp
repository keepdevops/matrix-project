#include "mode.h"
#include "../agent_client.h"

#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

using json = nlohmann::json;

namespace {

// Build the staged prompt fed to stage N>1: original request + previous output.
std::string build_staged_prompt(const std::string& user_prompt,
                                const std::string& prev_agent,
                                const std::string& prev_output) {
    std::string out;
    out.reserve(user_prompt.size() + prev_output.size() + 160);
    out += "Original user request:\n<<<\n";
    out += user_prompt;
    out += "\n>>>\n\nPrevious step (";
    out += prev_agent;
    out += ") produced:\n<<<\n";
    out += prev_output;
    out += "\n>>>\n\nContinue the pipeline.";
    return out;
}

// Sequential chain: each stage feeds the next. Order comes from mode_config.
json run_pipeline(const ModeContext& ctx) {
    json agent_outputs = json::object();
    json meta = json::object();

    if (!ctx.mode_config.contains("order") || !ctx.mode_config["order"].is_array()
        || ctx.mode_config["order"].empty()) {
        std::cerr << "❌ [pipeline] mode_config.order missing or empty" << std::endl;
        meta["error"] = "pipeline.order not configured";
        return json{
            {"mode", "pipeline"},
            {"agents", agent_outputs},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::unordered_map<std::string, const Agent*> by_name;
    for (const auto& a : ctx.agents) by_name[a.name] = &a;

    std::vector<std::string> executed;
    std::vector<std::string> missing;

    const auto& order = ctx.mode_config["order"];
    std::string prev_agent;
    std::string prev_output;
    std::string final_output;

    const size_t total = order.size();
    size_t step = 0;
    for (const auto& item : order) {
        if (!item.is_string()) continue;
        const std::string name = item.get<std::string>();
        auto it = by_name.find(name);
        if (it == by_name.end()) {
            std::cerr << "⚠️  [pipeline] skipping unknown agent '" << name << "'" << std::endl;
            missing.push_back(name);
            continue;
        }
        ++step;
        std::cout << "🔗 [pipeline] step " << step << "/" << total
                  << " → " << name << std::endl;

        const std::string staged = prev_agent.empty()
            ? ctx.user_prompt
            : build_staged_prompt(ctx.user_prompt, prev_agent, prev_output);

        std::string result = call_agent(*it->second, staged);
        agent_outputs[name] = result;
        executed.push_back(name);
        prev_agent = name;
        prev_output = result;
        final_output = result;
    }

    if (executed.empty()) {
        std::cerr << "❌ [pipeline] no agents from order matched active agents" << std::endl;
        meta["error"] = "no agents in 'order' matched active agents";
        meta["missing"] = missing;
        return json{
            {"mode", "pipeline"},
            {"agents", agent_outputs},
            {"final", nullptr},
            {"meta", meta}
        };
    }

    std::cout << "✅ [pipeline] final from " << prev_agent << std::endl;

    meta["order"] = executed;
    meta["missing"] = missing;
    return json{
        {"mode", "pipeline"},
        {"agents", agent_outputs},
        {"final", final_output},
        {"meta", meta}
    };
}

struct Register {
    Register() {
        modes::register_mode({
            "pipeline",
            "Sequential chain — each agent receives the previous agent's output.",
            run_pipeline
        });
    }
} _reg;

} // namespace
