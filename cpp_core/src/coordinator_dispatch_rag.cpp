#include "coordinator_dispatch_rag.h"
#include "rag_client.h"
#include "rag_config.h"

#include <algorithm>

RagDispatchPrep prepare_rag_for_dispatch(
    const nlohmann::json& body,
    const std::string& user_prompt,
    const std::string& effective_prompt_in,
    const nlohmann::json& startup_config) {
    RagDispatchPrep out;
    out.effective_prompt = effective_prompt_in;

    const bool use_rag = body.value("use_rag", false);
    if (!use_rag) return out;

    const int rag_top_k_override = body.value("rag_top_k", 0);
    const double rag_min_score_override = body.value("rag_min_score", -1.0);
    std::unordered_set<std::string> rag_agents_set;
    if (body.contains("rag_agents") && body["rag_agents"].is_array()) {
        for (const auto& a : body["rag_agents"]) {
            if (a.is_string()) rag_agents_set.insert(a.get<std::string>());
        }
    }

    rag::Settings rag_s = rag::settings_from_config(startup_config);
    if (rag_top_k_override > 0) {
        rag_s.top_k = std::min(rag_top_k_override, 20);
    }
    if (rag_min_score_override >= 0.0 && rag_min_score_override <= 1.0) {
        rag_s.min_score = rag_min_score_override;
    }
    if (!rag_s.enabled) {
        out.rag_meta = {{"requested", true}, {"used", false},
                        {"reason", "rag.enabled is false in coordinator config"}};
        return out;
    }

    auto hits = rag::retrieve(rag_s, user_prompt);
    std::string block = rag::render_context_block(hits);
    if (!block.empty()) {
        if (rag_agents_set.empty()) {
            out.effective_prompt = block + out.effective_prompt;
        } else {
            out.rag_block_for_ctx = block;
        }
    }
    nlohmann::json sources = nlohmann::json::array();
    for (const auto& h : hits) {
        sources.push_back({{"source_path", h.source_path},
                           {"chunk_idx", h.chunk_idx},
                           {"distance", h.distance},
                           {"content", h.content}});
    }
    nlohmann::json rag_agents_arr = nlohmann::json::array();
    for (const auto& n : rag_agents_set) rag_agents_arr.push_back(n);
    out.rag_meta = {{"requested", true},
                    {"used", !hits.empty()},
                    {"top_k", rag_s.top_k},
                    {"min_score", rag_s.min_score},
                    {"hits", sources}};
    if (!rag_agents_set.empty()) out.rag_meta["targeted_agents"] = rag_agents_arr;
    return out;
}
