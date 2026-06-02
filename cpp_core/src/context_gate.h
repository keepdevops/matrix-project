#pragma once
// Summarization gate — included only by coordinator_routes_dispatch.cpp.
// If effective_prompt exceeds max_input_chars, compress it through a
// context_agent before dispatch.

#include "agent.h"
#include "agent_client.h"
#include "symbolic_importance.h"
#include "json.hpp"
#include <iostream>
#include <string>
#include <vector>

namespace context_gate {

struct Config {
    bool        enabled         = false;
    int         max_input_chars = 8000;
    std::string context_agent;
};

inline Config load(const nlohmann::json& coordinator_block) {
    Config cfg;
    if (!coordinator_block.contains("context_gate")) return cfg;
    const auto& g = coordinator_block["context_gate"];
    cfg.enabled         = g.value("enabled", false);
    cfg.max_input_chars = g.value("max_input_chars", 8000);
    cfg.context_agent   = g.value("context_agent", std::string(""));
    return cfg;
}

// Returns summarised prompt, or original if gate not triggered / no agent found.
// Sets triggered=true and populates meta when gate fires.
inline std::string maybe_summarise(
    const Config& cfg,
    const std::vector<Agent>& agents,
    const std::string& prompt,
    nlohmann::json& gate_meta)
{
    gate_meta = {{"triggered", false}};
    if (!cfg.enabled || cfg.context_agent.empty()) return prompt;
    if ((int)prompt.size() <= cfg.max_input_chars) return prompt;

    const Agent* agent = nullptr;
    for (const auto& a : agents)
        if (a.name == cfg.context_agent) { agent = &a; break; }
    if (!agent) {
        // Fall back to any agent tagged "context"
        for (const auto& a : agents)
            for (const auto& t : a.tags)
                if (t == "context") { agent = &a; break; }
    }
    if (!agent) {
        std::cerr << "⚠️  [context_gate] no agent '" << cfg.context_agent
                  << "' found; skipping compression" << std::endl;
        return prompt;
    }

    static const std::string kSystem =
        "You are a context compressor. Summarise the following input concisely, "
        "preserving all key facts, code snippets, and requirements. "
        "Output only the summary — no preamble.";

    std::cout << "✂️  [context_gate] prompt " << prompt.size()
              << " chars > " << cfg.max_input_chars
              << "; compressing via " << agent->name << std::endl;

    std::string summary = call_agent_with_system(*agent, kSystem, prompt);
    // Fidelity ratio: compare importance scores of original vs summary
    double imp_orig    = symbolic_importance::score(prompt, (double)prompt.size());
    double imp_summary = symbolic_importance::score(summary, (double)prompt.size());
    double fidelity    = (imp_orig > 0.0) ? imp_summary / imp_orig : 1.0;

    gate_meta = {
        {"triggered",           true},
        {"original_chars",      (int)prompt.size()},
        {"summary_chars",       (int)summary.size()},
        {"agent",               agent->name},
        {"importance_original", imp_orig},
        {"importance_summary",  imp_summary},
        {"fidelity_ratio",      fidelity},
    };
    std::cout << "✅ [context_gate] compressed to " << summary.size()
              << " chars (fidelity=" << (int)(fidelity * 100) << "%)" << std::endl;
    return summary;
}

} // namespace context_gate
