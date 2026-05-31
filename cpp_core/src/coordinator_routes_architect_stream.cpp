#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_architect_synthesis.h"
#include "coordinator_routes_architect_persist.h"
#include "modes/pipeline_prompts.h"
#include "modes/router_selected_parse.h"
#include "session_store.h"

#include <chrono>
#include <unordered_set>

void register_coordinator_routes_architect_stream(httplib::Server& svr, CoordinatorState& st) {
    // 5b. Streaming dispatch (SSE): parallel or pipeline/router/cascade paths.
    svr.Post("/api/architect/stream", [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::string user_prompt;
        std::string req_session_id;
        std::string req_parent_run_id;
        double temperature = 0.7;
        bool followup = false;
        json context_policy = json::object();
        try {
            auto j = json::parse(req.body);
            user_prompt       = j.value("prompt", "");
            req_session_id    = j.value("session_id", std::string(""));
            req_parent_run_id = j.value("parent_run_id", std::string(""));
            temperature       = j.value("temperature", 0.7);
            followup          = j.value("followup", false);
            if (j.contains("context_policy") && j["context_policy"].is_object())
                context_policy = j["context_policy"];
        } catch (...) {
            user_prompt = req.body;
        }
        if (user_prompt.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"empty prompt\"}", "application/json");
            return;
        }

        if (req_session_id.empty()) req_session_id = session_new_id("sess");
        const std::string run_id = session_new_id("run");

        std::string effective_prompt = user_prompt;
        if (followup && !req_session_id.empty()) {
            std::lock_guard<std::mutex> lock(st.sessions_mutex);
            SessionContinuation cont = session_build_continuation(
                st.sessions, req_session_id, user_prompt, context_policy);
            effective_prompt = cont.prompt;
        }

        const std::string mode_name = modes::active();
        json cfg_for_mode;
        {
            std::lock_guard<std::mutex> lock(st.modes_config_mutex);
            cfg_for_mode = st.modes_config.contains(mode_name)
                ? st.modes_config[mode_name] : json::object();
        }
        auto filtered = filter_agents_for_mode(st, mode_name);
        filtered.erase(std::remove_if(filtered.begin(), filtered.end(),
            [](const Agent& a){ return agent_health::is_open(a.name); }),
            filtered.end());

        auto agents_snap = std::make_shared<std::vector<Agent>>(std::move(filtered));
        auto prompt_snap = std::make_shared<std::string>(effective_prompt);
        auto cfg_snap    = std::make_shared<json>(std::move(cfg_for_mode));
        auto mode_snap   = std::make_shared<std::string>(mode_name);
        auto cancel      = std::make_shared<std::atomic<bool>>(false);
        agent_metrics::reset();

        auto session_id_snap    = std::make_shared<std::string>(req_session_id);
        auto run_id_snap        = std::make_shared<std::string>(run_id);
        auto parent_run_id_snap = std::make_shared<std::string>(req_parent_run_id);
        auto temperature_snap   = std::make_shared<double>(temperature);
        auto user_prompt_snap   = std::make_shared<std::string>(user_prompt);

        res.set_chunked_content_provider("text/event-stream",
            [agents_snap, prompt_snap, user_prompt_snap, cfg_snap, mode_snap, cancel,
             session_id_snap, run_id_snap, parent_run_id_snap, temperature_snap, &st]
            (size_t /*offset*/, httplib::DataSink& sink) -> bool {
                std::mutex sink_mu;
                WriteEventFn write_event = [&](const std::string& event,
                                               const std::string& data_json) {
                    std::lock_guard<std::mutex> lock(sink_mu);
                    if (!sink.is_writable()) { cancel->store(true); return; }
                    std::string frame = "event: " + event + "\ndata: "
                                        + data_json + "\n\n";
                    sink.write(frame.data(), frame.size());
                };

                std::string synth_name;
                if (cfg_snap->contains("synthesizer")
                    && (*cfg_snap)["synthesizer"].is_string()) {
                    synth_name = (*cfg_snap)["synthesizer"].get<std::string>();
                }
                const Agent* synth_agent = nullptr;
                for (const auto& a : *agents_snap) {
                    if (a.name == synth_name) { synth_agent = &a; break; }
                }

                static constexpr size_t TOKEN_BATCH_BYTES = 128;

                auto stream_parallel = [&](const std::vector<const Agent*>& parallel_agents,
                                           std::map<std::string, std::string>& outputs) {
                    std::mutex out_mu;
                    std::vector<std::thread> threads;
                    threads.reserve(parallel_agents.size());
                    for (const Agent* a : parallel_agents) {
                        threads.emplace_back([a, prompt_snap, cancel,
                                              &write_event, &outputs, &out_mu]() {
                            std::string assembled;
                            std::string batch;
                            auto flush_batch = [&]() {
                                if (batch.empty()) return;
                                write_event("token",
                                    json({{"agent", a->name}, {"delta", batch}}).dump());
                                batch.clear();
                            };
                            auto on_chunk = [&](const std::string& delta) {
                                assembled += delta;
                                batch    += delta;
                                if (batch.size() >= TOKEN_BATCH_BYTES) flush_batch();
                            };
                            try {
                                agent_stream::stream_agent(*a, a->system_prompt,
                                                           *prompt_snap, on_chunk,
                                                           cancel.get());
                            } catch (const std::exception& e) {
                                flush_batch();
                                write_event("error",
                                    json({{"agent", a->name}, {"error", e.what()}}).dump());
                            }
                            flush_batch();
                            {
                                std::lock_guard<std::mutex> lk(out_mu);
                                outputs[a->name] = assembled;
                            }
                            write_event("agent_done",
                                json({{"agent", a->name}}).dump());
                        });
                    }
                    for (auto& t : threads) t.join();
                };

                auto do_synthesis = [&](const std::vector<std::string>& contributors,
                                        std::map<std::string, std::string>& outputs) {
                    run_stream_synthesis(synth_agent, *prompt_snap, *mode_snap,
                                         contributors, outputs, cancel.get(), write_event);
                };

                std::map<std::string, std::string> outputs;
                std::vector<std::string> participants;

                if (*mode_snap == "pipeline") {
                    std::vector<const Agent*> order;
                    if (cfg_snap->contains("agents") && (*cfg_snap)["agents"].is_array()
                        && !(*cfg_snap)["agents"].empty()) {
                        std::map<std::string, const Agent*> by_name;
                        for (const auto& a : *agents_snap) by_name[a.name] = &a;
                        for (const auto& n : (*cfg_snap)["agents"]) {
                            if (!n.is_string()) continue;
                            const std::string nm = n.get<std::string>();
                            if (nm == synth_name) continue;
                            auto it = by_name.find(nm);
                            if (it != by_name.end()) order.push_back(it->second);
                        }
                    } else {
                        for (const auto& a : *agents_snap) {
                            if (a.name == synth_name) continue;
                            order.push_back(&a);
                        }
                    }
                    int total = (int)order.size();
                    int step = 0;
                    std::string prev_agent, prev_output;
                    for (const Agent* a : order) {
                        ++step;
                        write_event("stage", json({
                            {"step", step}, {"total", total}, {"agent", a->name}
                        }).dump());
                        std::string staged = prev_agent.empty()
                            ? *prompt_snap
                            : build_pipeline_staged_user_prompt(*prompt_snap, prev_agent, prev_output);
                        std::string assembled;
                        auto on_chunk = [&](const std::string& delta) {
                            assembled += delta;
                            write_event("token",
                                json({{"agent", a->name}, {"delta", delta}}).dump());
                        };
                        try {
                            agent_stream::stream_agent(*a, a->system_prompt,
                                staged, on_chunk, cancel.get());
                        } catch (const std::exception& e) {
                            write_event("error",
                                json({{"agent", a->name}, {"error", e.what()}}).dump());
                        }
                        outputs[a->name] = assembled;
                        participants.push_back(a->name);
                        prev_agent = a->name;
                        prev_output = assembled;
                        write_event("agent_done",
                            json({{"agent", a->name}}).dump());
                    }
                    do_synthesis(participants, outputs);

                } else if (*mode_snap == "router") {
                    std::string classifier_name = cfg_snap->value("classifier", std::string(""));
                    int max_select = cfg_snap->value("max_select", 3);
                    std::map<std::string, const Agent*> by_name;
                    for (const auto& a : *agents_snap) by_name[a.name] = &a;
                    if (classifier_name.empty() || !by_name.count(classifier_name)) {
                        if (!agents_snap->empty()) classifier_name = agents_snap->front().name;
                    }
                    std::vector<std::string> choices;
                    for (const auto& a : *agents_snap) {
                        if (a.name != classifier_name) choices.push_back(a.name);
                    }
                    std::string choices_csv;
                    for (size_t i = 0; i < choices.size(); ++i) {
                        if (i) choices_csv += ", ";
                        choices_csv += choices[i];
                    }
                    std::string classifier_user =
                        "Allowed agents: " + choices_csv + "\n\nUser request:\n" +
                        *prompt_snap + "\n\nRespond with one line: SELECTED: <agents>.";
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
                    write_event("selected", json({
                        {"classifier", classifier_name},
                        {"agents", picked}
                    }).dump());
                    std::vector<const Agent*> selected_agents;
                    for (const auto& n : picked) selected_agents.push_back(by_name[n]);
                    stream_parallel(selected_agents, outputs);

                } else {
                    std::vector<const Agent*> bcast;
                    for (const auto& a : *agents_snap) {
                        if (a.name == synth_name) continue;
                        bcast.push_back(&a);
                        participants.push_back(a.name);
                    }
                    stream_parallel(bcast, outputs);
                    if (*mode_snap == "cascade") {
                        do_synthesis(participants, outputs);
                    }
                }

                json metrics = agent_metrics::snapshot();
                write_event("metrics", metrics.dump());

                persist_stream_run(*user_prompt_snap, *temperature_snap, *mode_snap,
                    *session_id_snap, *run_id_snap, *parent_run_id_snap,
                    outputs, st, write_event);

                {
                    std::lock_guard<std::mutex> lock(sink_mu);
                    if (sink.is_writable()) {
                        std::string fin = "event: done\ndata: [DONE]\n\n";
                        sink.write(fin.data(), fin.size());
                    }
                    sink.done();
                }
                return true;
            });
    });
}
