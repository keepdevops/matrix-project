#include "coordinator_routes_dispatch_prepare.h"
#include "rag_client.h"
#include "rag_config.h"
#include "session_store.h"
#include "code_fence_normalize.h"
#include <iostream>
#include <unordered_set>

DispatchRequest dispatch_parse_request(const json& body) {
    DispatchRequest r;
    r.prompt          = body.value("prompt", "");
    r.temperature     = body.value("temperature", 0.7);
    r.followup        = body.value("followup", false);
    r.quality_pass    = body.value("quality_pass", false);
    r.session_id      = body.value("session_id", std::string(""));
    r.parent_run_id   = body.value("parent_run_id", std::string(""));
    r.context_policy  = body.value("context_policy", json::object());
    r.use_rag         = body.value("use_rag", false);
    r.rag_top_k       = body.value("rag_top_k", 0);
    r.rag_min_score   = body.value("rag_min_score", -1.0);
    if (body.contains("rag_agents") && body["rag_agents"].is_array()) {
        for (const auto& a : body["rag_agents"])
            if (a.is_string()) r.rag_agents.insert(a.get<std::string>());
    }
    if (r.session_id.empty()) r.session_id = session_new_id("sess");
    r.run_id = session_new_id("run");
    return r;
}

RagResult dispatch_build_rag(const DispatchRequest& req, CoordinatorState& st) {
    RagResult result;
    result.effective_prompt = req.effective_prompt;

    if (!req.use_rag) return result;

    rag::Settings rag_s = rag::settings_from_config(st.startup_config);
    if (req.rag_top_k > 0) rag_s.top_k = std::min(req.rag_top_k, 20);
    if (req.rag_min_score >= 0.0 && req.rag_min_score <= 1.0)
        rag_s.min_score = req.rag_min_score;

    if (!rag_s.enabled) {
        result.rag_meta = {{"requested", true}, {"used", false},
                           {"reason", "rag.enabled is false in coordinator config"}};
        return result;
    }

    auto hits = rag::retrieve(rag_s, req.prompt);
    std::string block = rag::render_context_block(hits);
    if (!block.empty()) {
        if (req.rag_agents.empty()) {
            result.effective_prompt = block + result.effective_prompt;
        } else {
            result.rag_block = block;
        }
    }

    json sources = json::array();
    for (const auto& h : hits) {
        sources.push_back({{"source_path", h.source_path},
                           {"chunk_idx",   h.chunk_idx},
                           {"distance",    h.distance},
                           {"content",     h.content}});
    }
    json rag_agents_arr = json::array();
    for (const auto& n : req.rag_agents) rag_agents_arr.push_back(n);

    result.rag_meta = {{"requested", true},
                       {"used",      !hits.empty()},
                       {"top_k",     rag_s.top_k},
                       {"min_score", rag_s.min_score},
                       {"hits",      sources}};
    if (!req.rag_agents.empty()) result.rag_meta["targeted_agents"] = rag_agents_arr;
    return result;
}

void dispatch_write_history(
        CoordinatorState& st,
        const json& envelope,
        const std::string& user_prompt,
        double temperature,
        long long timestamp_ms,
        const std::string& session_id,
        const std::string& run_id,
        const std::string& parent_run_id,
        const std::string& effective_prompt,
        bool followup,
        bool quality_pass,
        const std::string& mode_name,
        const json& compaction) {
    json entry = envelope.value("agents", json::object());
    entry["prompt"]      = user_prompt;
    entry["temperature"] = temperature;
    entry["timestamp"]   = timestamp_ms;
    if (!envelope.value("final", json()).is_null()) entry["_final"] = envelope["final"];
    if (envelope.contains("mode"))  entry["_mode"]       = envelope["mode"];
    entry["_session_id"] = session_id;
    entry["_run_id"]     = run_id;
    code_fence::normalize_agents_in_entry(entry);

    {
        std::lock_guard<std::mutex> lock(st.history_mutex);
        st.history.push_back(entry);
        coordinator_save_history(st);
    }
    {
        std::lock_guard<std::mutex> lock(st.sessions_mutex);
        json run = {
            {"run_id",           run_id},
            {"parent_run_id",    parent_run_id},
            {"prompt",           user_prompt},
            {"effective_prompt", effective_prompt},
            {"followup",         followup},
            {"quality_pass",     quality_pass},
            {"mode",             mode_name},
            {"agents", [&]() {
                json agents = envelope.value("agents", json::object());
                code_fence::normalize_agents_in_entry(agents);
                return agents;
            }()},
            {"final",     envelope.value("final", json(nullptr))},
            {"timestamp", timestamp_ms}
        };
        if (followup) run["compaction"] = compaction;
        session_append_run(st.sessions, session_id, run);
        coordinator_save_sessions(st);
    }
}
