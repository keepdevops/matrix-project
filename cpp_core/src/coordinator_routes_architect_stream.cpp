#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_architect_stream_modes.h"
#include "coordinator_routes_architect_persist.h"
#include "coordinator_routes_architect_stream_parse.h"
#include "session_store.h"

void register_coordinator_routes_architect_stream(httplib::Server& svr, CoordinatorState& st) {
    svr.Post("/api/architect/stream", [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");

        auto sreq = stream_parse::parse(req.body);
        if (sreq.user_prompt.empty()) {
            res.status = 400;
            res.set_content("{\"error\":\"empty prompt\"}", "application/json");
            return;
        }

        if (sreq.session_id.empty()) sreq.session_id = session_new_id("sess");
        const std::string run_id = session_new_id("run");

        std::string effective_prompt = sreq.user_prompt;
        if (sreq.followup && !sreq.session_id.empty()) {
            std::lock_guard<std::mutex> lock(st.sessions_mutex);
            SessionContinuation cont = session_build_continuation(
                st.sessions, sreq.session_id, sreq.user_prompt, sreq.context_policy);
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

        auto agents_snap        = std::make_shared<std::vector<Agent>>(std::move(filtered));
        auto prompt_snap        = std::make_shared<std::string>(effective_prompt);
        auto cfg_snap           = std::make_shared<json>(std::move(cfg_for_mode));
        auto mode_snap          = std::make_shared<std::string>(mode_name);
        auto cancel             = std::make_shared<std::atomic<bool>>(false);
        auto session_id_snap    = std::make_shared<std::string>(sreq.session_id);
        auto run_id_snap        = std::make_shared<std::string>(run_id);
        auto parent_run_id_snap = std::make_shared<std::string>(sreq.parent_run_id);
        auto temperature_snap   = std::make_shared<double>(sreq.temperature);
        auto user_prompt_snap   = std::make_shared<std::string>(sreq.user_prompt);
        agent_metrics::reset();

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
                    && (*cfg_snap)["synthesizer"].is_string())
                    synth_name = (*cfg_snap)["synthesizer"].get<std::string>();

                const Agent* synth_agent = nullptr;
                for (const auto& a : *agents_snap)
                    if (a.name == synth_name) { synth_agent = &a; break; }

                std::map<std::string, std::string> outputs;
                std::vector<std::string> participants;

                if (*mode_snap == "pipeline") {
                    run_stream_pipeline_mode(*agents_snap, *cfg_snap, synth_name,
                        synth_agent, *prompt_snap, *mode_snap, cancel.get(),
                        write_event, outputs, participants);
                } else if (*mode_snap == "router") {
                    run_stream_router_mode(*agents_snap, *cfg_snap, *prompt_snap,
                        cancel.get(), write_event, outputs);
                } else {
                    run_stream_broadcast_mode(*agents_snap, synth_name, *mode_snap,
                        synth_agent, *prompt_snap, cancel.get(), write_event,
                        outputs, participants);
                }

                write_event("metrics", agent_metrics::snapshot().dump());

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
