#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_modes(httplib::Server& svr, CoordinatorState& st) {
    svr.Get("/api/modes", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string cur = modes::active();
        json out = json::array();
        for (const auto& m : modes::list()) {
            out.push_back({{"name", m.name}, {"description", m.description}, {"active", m.name == cur}});
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
                    {"error","unknown mode"}, {"requested",name}, {"available",available}
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

    // GET /api/modes/<name>/agents — read per-mode roster
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
        for (const auto& a : st.agents) { all.push_back(a.name); active_set.insert(a.name); }
        json effective_agents = json::array();
        json stale = json::array();
        if (explicit_set) {
            std::set<std::string> emitted;
            for (const auto& item : configured) {
                if (!item.is_string()) continue;
                const std::string n = item.get<std::string>();
                if (active_set.count(n)) {
                    if (mode_name == "pipeline" || emitted.insert(n).second)
                        effective_agents.push_back(n);
                } else {
                    stale.push_back(n);
                }
            }
        } else {
            effective_agents = all;
        }
        json out = {
            {"mode", mode_name}, {"agents", effective_agents},
            {"configured_agents", configured}, {"stale", stale},
            {"explicit", explicit_set}, {"available", all}
        };
        {
            std::lock_guard<std::mutex> lock(st.modes_config_mutex);
            if (st.modes_config.contains(mode_name)) {
                const auto& mc = st.modes_config[mode_name];
                if (mc.contains("max_select") && mc["max_select"].is_number_integer())
                    out["max_select"] = mc["max_select"];
                if (mc.contains("synthesizer") && mc["synthesizer"].is_string())
                    out["synthesizer"] = mc["synthesizer"];
                for (const auto& key : {"variant_policy","preset","synthesis_policy","classifier_policy"}) {
                    if (mc.contains(key) && mc[key].is_string()) out[key] = mc[key];
                }
                if (mc.contains("stage_context_chars") && mc["stage_context_chars"].is_number_integer())
                    out["stage_context_chars"] = mc["stage_context_chars"];
                if (mode_name == "pipeline" && mc.contains("order") && mc["order"].is_array())
                    out["order"] = mc["order"];
            }
        }
        res.set_content(out.dump(), "application/json");
    });

    // PUT /api/modes/<name>/agents — write per-mode roster (body handled in modes_put.cpp)
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
        handle_mode_agents_put(st, mode_name, req, res);
    });
}
