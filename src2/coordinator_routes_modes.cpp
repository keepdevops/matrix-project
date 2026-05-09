#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_modes(httplib::Server& svr, CoordinatorState& st) {
    // 4. Mode registry — list all modes + active flag
    svr.Get("/api/modes", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string cur = modes::active();
        json out = json::array();
        for (const auto& m : modes::list()) {
            out.push_back({
                {"name", m.name},
                {"description", m.description},
                {"active", m.name == cur}
            });
        }
        res.set_content(out.dump(), "application/json");
    });

    svr.Get("/api/modes/active", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(json({{"mode", modes::active()}}).dump(), "application/json");
    });

    svr.Post("/api/modes/active", [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        try {
            auto j = json::parse(req.body);
            std::string name = j.value("mode", "");
            if (!modes::set_active(name)) {
                json available = json::array();
                for (const auto& m : modes::list()) available.push_back(m.name);
                res.status = 404;
                res.set_content(json({
                    {"error", "unknown mode"},
                    {"requested", name},
                    {"available", available}
                }).dump(), "application/json");
                return;
            }
            std::cout << "🧠 active mode switched to: " << name << std::endl;
            res.set_content(json({{"mode", name}}).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [modes/active] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 4b. Per-mode roster — read & write the agent subset that participates in a mode
    svr.Get(R"(/api/modes/([A-Za-z0-9_-]+)/agents)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string mode_name = req.matches[1];
        if (!modes::get(mode_name)) {
            res.status = 404;
            res.set_content(json({{"error","unknown mode"},{"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        json configured = json::array();
        bool explicit_set = false;
        {
            std::lock_guard<std::mutex> lock(st.modes_config_mutex);
            if (st.modes_config.contains(mode_name)
                && st.modes_config[mode_name].contains("agents")
                && st.modes_config[mode_name]["agents"].is_array()
                && !st.modes_config[mode_name]["agents"].empty()) {
                configured = st.modes_config[mode_name]["agents"];
                explicit_set = true;
            }
        }
        json all = json::array();
        std::set<std::string> active_set;
        for (const auto& a : st.agents) {
            all.push_back(a.name);
            active_set.insert(a.name);
        }
        // Intersect configured with currently-deployed st.agents so the UI never
        // round-trips ghost names back through PUT. `configured_agents` exposes
        // the raw on-disk list and `stale` lists names dropped since deploy,
        // so operators can see drift instead of it being silently hidden.
        json effective_agents = json::array();
        json stale = json::array();
        if (explicit_set) {
            for (const auto& item : configured) {
                if (!item.is_string()) continue;
                const std::string n = item.get<std::string>();
                if (active_set.count(n)) effective_agents.push_back(n);
                else stale.push_back(n);
            }
        } else {
            effective_agents = all;
        }
        json out = {
            {"mode", mode_name},
            {"agents", effective_agents},
            {"configured_agents", configured},
            {"stale", stale},
            {"explicit", explicit_set},
            {"available", all}
        };
        {
            std::lock_guard<std::mutex> lock(st.modes_config_mutex);
            if (st.modes_config.contains(mode_name)
                && st.modes_config[mode_name].contains("max_select")
                && st.modes_config[mode_name]["max_select"].is_number_integer()) {
                out["max_select"] = st.modes_config[mode_name]["max_select"];
            }
            if (st.modes_config.contains(mode_name)
                && st.modes_config[mode_name].contains("synthesizer")
                && st.modes_config[mode_name]["synthesizer"].is_string()) {
                out["synthesizer"] = st.modes_config[mode_name]["synthesizer"];
            }
        }
        res.set_content(out.dump(), "application/json");
    });

    svr.Put(R"(/api/modes/([A-Za-z0-9_-]+)/agents)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string mode_name = req.matches[1];
        if (!modes::get(mode_name)) {
            res.status = 404;
            res.set_content(json({{"error","unknown mode"},{"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        try {
            auto body = json::parse(req.body);
            const bool has_agents = body.contains("agents") && body["agents"].is_array();
            const bool has_max    = body.contains("max_select") && body["max_select"].is_number_integer();
            const bool has_synth  = body.contains("synthesizer")
                                    && (body["synthesizer"].is_string() || body["synthesizer"].is_null());
            if (!has_agents && !has_max && !has_synth) {
                res.status = 400;
                res.set_content(json({{"error","provide 'agents', 'max_select', or 'synthesizer'"}}).dump(),
                                "application/json");
                return;
            }
            std::set<std::string> active_names;
            for (const auto& a : st.agents) active_names.insert(a.name);
            json normalized = json::array();
            json unknown = json::array();
            size_t requested_count = 0;
            if (has_agents) {
                for (const auto& item : body["agents"]) {
                    if (!item.is_string()) continue;
                    ++requested_count;
                    const std::string n = item.get<std::string>();
                    if (active_names.count(n)) normalized.push_back(n);
                    else unknown.push_back(n);
                }
            }
            // Guard: a non-empty roster where every name is unknown would
            // silently erase the explicit override on disk. Refuse and let
            // the client decide whether to retry with a corrected list or
            // call clearOverride explicitly.
            if (has_agents && requested_count > 0 && normalized.empty()) {
                res.status = 409;
                res.set_content(json({
                    {"error","all requested agents unknown — refusing to erase roster"},
                    {"mode", mode_name},
                    {"unknown", unknown},
                    {"hint","send agents:[] explicitly to clear the override"}
                }).dump(), "application/json");
                return;
            }
            std::string unknown_synth_name;
            int max_select_val = 0;
            if (has_max) {
                max_select_val = body["max_select"].get<int>();
                if (max_select_val < 1) max_select_val = 1;
            }
            bool persisted = false;
            {
                std::lock_guard<std::mutex> lock(st.modes_config_mutex);
                if (!st.modes_config.contains(mode_name) || !st.modes_config[mode_name].is_object()) {
                    st.modes_config[mode_name] = json::object();
                }
                if (has_agents) st.modes_config[mode_name]["agents"] = normalized;
                if (has_max)    st.modes_config[mode_name]["max_select"] = max_select_val;
                if (has_synth) {
                    if (body["synthesizer"].is_null()
                        || body["synthesizer"].get<std::string>().empty()) {
                        st.modes_config[mode_name].erase("synthesizer");
                    } else {
                        const std::string sn = body["synthesizer"].get<std::string>();
                        if (active_names.count(sn)) {
                            st.modes_config[mode_name]["synthesizer"] = sn;
                        } else {
                            // Tracked separately from `unknown` so the UI can
                            // surface "synthesizer not deployed" distinctly.
                            unknown_synth_name = sn;
                        }
                    }
                }
                persisted = coordinator_persist_modes_locked(st);
            }
            std::cout << "🧩 [modes/" << mode_name << "/agents] "
                      << (has_agents ? std::to_string(normalized.size()) + " agent(s) " : "")
                      << (has_max ? "max_select=" + std::to_string(max_select_val) : "")
                      << (persisted ? "" : " (persistence FAILED)") << std::endl;
            json out = {
                {"mode", mode_name},
                {"agents", normalized},
                {"unknown", unknown},
                {"unknown_synthesizer", unknown_synth_name.empty()
                    ? json(nullptr) : json(unknown_synth_name)},
                {"persisted", persisted}
            };
            if (has_max) out["max_select"] = max_select_val;
            res.set_content(out.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [modes/agents PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });
}
