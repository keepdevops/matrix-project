#include "coordinator_routes_architect_stream_modes.h"
#include "agent_client.h"
#include "agent_stream.h"
#include "modes/pipeline_prompts.h"
#include "modes/router_selected_parse.h"

#include <map>
#include <mutex>
#include <thread>
#include <unordered_set>

namespace {

static constexpr size_t TOKEN_BATCH_BYTES = 128;

}  // namespace

void stream_parallel_agents(const std::vector<const Agent*>& parallel_agents,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs) {
    std::mutex out_mu;
    std::vector<std::thread> threads;
    threads.reserve(parallel_agents.size());
    for (const Agent* a : parallel_agents) {
        threads.emplace_back([a, &prompt, cancel, &write_event, &outputs, &out_mu]() {
            std::string assembled;
            std::string batch;
            auto flush_batch = [&]() {
                if (batch.empty()) return;
                write_event("token",
                    nlohmann::json({{"agent", a->name}, {"delta", batch}}).dump());
                batch.clear();
            };
            auto on_chunk = [&](const std::string& delta) {
                assembled += delta;
                batch    += delta;
                if (batch.size() >= TOKEN_BATCH_BYTES) flush_batch();
            };
            try {
                agent_stream::stream_agent(*a, a->system_prompt,
                                           prompt, on_chunk, cancel);
            } catch (const std::exception& e) {
                flush_batch();
                write_event("error",
                    nlohmann::json({{"agent", a->name}, {"error", e.what()}}).dump());
            }
            flush_batch();
            {
                std::lock_guard<std::mutex> lk(out_mu);
                outputs[a->name] = assembled;
            }
            write_event("agent_done", nlohmann::json({{"agent", a->name}}).dump());
        });
    }
    for (auto& t : threads) t.join();
}

void run_stream_pipeline_mode(const std::vector<Agent>& agents,
                              const nlohmann::json& cfg,
                              const std::string& synth_name,
                              const Agent* synth_agent,
                              const std::string& prompt,
                              const std::string& mode,
                              std::atomic<bool>* cancel,
                              const WriteEventFn& write_event,
                              std::map<std::string, std::string>& outputs,
                              std::vector<std::string>& participants) {
    std::vector<const Agent*> order;
    if (cfg.contains("agents") && cfg["agents"].is_array() && !cfg["agents"].empty()) {
        std::map<std::string, const Agent*> by_name;
        for (const auto& a : agents) by_name[a.name] = &a;
        for (const auto& n : cfg["agents"]) {
            if (!n.is_string()) continue;
            const std::string nm = n.get<std::string>();
            if (nm == synth_name) continue;
            auto it = by_name.find(nm);
            if (it != by_name.end()) order.push_back(it->second);
        }
    } else {
        for (const auto& a : agents) {
            if (a.name == synth_name) continue;
            order.push_back(&a);
        }
    }
    int total = (int)order.size();
    int step = 0;
    std::string prev_agent, prev_output;
    for (const Agent* a : order) {
        ++step;
        write_event("stage", nlohmann::json({
            {"step", step}, {"total", total}, {"agent", a->name}
        }).dump());
        std::string staged = prev_agent.empty()
            ? prompt
            : build_pipeline_staged_user_prompt(prompt, prev_agent, prev_output);
        std::string assembled;
        auto on_chunk = [&](const std::string& delta) {
            assembled += delta;
            write_event("token",
                nlohmann::json({{"agent", a->name}, {"delta", delta}}).dump());
        };
        try {
            agent_stream::stream_agent(*a, a->system_prompt,
                staged, on_chunk, cancel);
        } catch (const std::exception& e) {
            write_event("error",
                nlohmann::json({{"agent", a->name}, {"error", e.what()}}).dump());
        }
        outputs[a->name] = assembled;
        participants.push_back(a->name);
        prev_agent = a->name;
        prev_output = assembled;
        write_event("agent_done", nlohmann::json({{"agent", a->name}}).dump());
    }
    run_stream_synthesis(synth_agent, prompt, mode, participants, outputs, cancel, write_event);
}

void run_stream_router_mode(const std::vector<Agent>& agents,
                            const nlohmann::json& cfg,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs) {
    std::string classifier_name = cfg.value("classifier", std::string(""));
    int max_select = cfg.value("max_select", 3);
    std::map<std::string, const Agent*> by_name;
    for (const auto& a : agents) by_name[a.name] = &a;
    if (classifier_name.empty() || !by_name.count(classifier_name)) {
        if (!agents.empty()) classifier_name = agents.front().name;
    }
    std::vector<std::string> choices;
    for (const auto& a : agents) {
        if (a.name != classifier_name) choices.push_back(a.name);
    }
    std::string choices_csv;
    for (size_t i = 0; i < choices.size(); ++i) {
        if (i) choices_csv += ", ";
        choices_csv += choices[i];
    }
    std::string classifier_user =
        "Allowed agents: " + choices_csv + "\n\nUser request:\n" +
        prompt + "\n\nRespond with one line: SELECTED: <agents>.";
    std::string classifier_system =
        "You are a routing classifier. Pick 1-" + std::to_string(max_select) +
        " agents from the allowed list. Respond with exactly one line: "
        "SELECTED: <a>, <b>. No prose.";
    std::string raw;
    if (by_name.count(classifier_name)) {
        try {
            raw = call_agent_with_system(*by_name[classifier_name],
                classifier_system, classifier_user);
        } catch (...) { raw = ""; }
    }
    std::unordered_set<std::string> valid_names;
    for (const auto& kv : by_name) valid_names.insert(kv.first);
    std::vector<std::string> picked = parse_router_selected_agents(
        raw, max_select, valid_names, classifier_name);
    if (picked.empty() && !choices.empty())
        picked.push_back(choices.front());
    write_event("selected", nlohmann::json({
        {"classifier", classifier_name},
        {"agents", picked}
    }).dump());
    std::vector<const Agent*> selected_agents;
    for (const auto& n : picked) selected_agents.push_back(by_name[n]);
    stream_parallel_agents(selected_agents, prompt, cancel, write_event, outputs);
}

void run_stream_broadcast_mode(const std::vector<Agent>& agents,
                               const std::string& synth_name,
                               const std::string& mode,
                               const Agent* synth_agent,
                               const std::string& prompt,
                               std::atomic<bool>* cancel,
                               const WriteEventFn& write_event,
                               std::map<std::string, std::string>& outputs,
                               std::vector<std::string>& participants) {
    std::vector<const Agent*> bcast;
    for (const auto& a : agents) {
        if (a.name == synth_name) continue;
        bcast.push_back(&a);
        participants.push_back(a.name);
    }
    stream_parallel_agents(bcast, prompt, cancel, write_event, outputs);
    if (mode == "cascade") {
        run_stream_synthesis(synth_agent, prompt, mode, participants, outputs, cancel, write_event);
    }
}
