#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_presets(httplib::Server& svr, CoordinatorState& st) {
    // 4d. Mode st.presets — named bundles of (mode, st.agents, synthesizer, max_select).
    // Saved to coordinator.presets in the config file; survive restart + redeploy.
    svr.Get("/api/presets", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(st.presets_mutex);
        res.set_content(st.presets.dump(), "application/json");
    });

    svr.Put(R"(/api/presets/([A-Za-z0-9_\-]+))",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        try {
            auto body = json::parse(req.body);
            if (!body.contains("mode") || !body["mode"].is_string()
                || !modes::get(body["mode"].get<std::string>())) {
                res.status = 400;
                res.set_content(json({{"error","missing or unknown 'mode'"}}).dump(),
                                "application/json");
                return;
            }
            json bundle = json::object();
            bundle["mode"] = body["mode"];
            if (body.contains("agents") && body["agents"].is_array()) {
                bundle["agents"] = body["agents"];
            }
            if (body.contains("synthesizer") && body["synthesizer"].is_string()
                && !body["synthesizer"].get<std::string>().empty()) {
                bundle["synthesizer"] = body["synthesizer"];
            }
            if (body.contains("max_select") && body["max_select"].is_number_integer()) {
                bundle["max_select"] = body["max_select"];
            }
            bool persisted = false;
            {
                std::lock_guard<std::mutex> lk(st.presets_mutex);
                st.presets[name] = bundle;
            }
            {
                std::lock_guard<std::mutex> lk(st.modes_config_mutex);
                persisted = coordinator_persist_modes_locked(st);
            }
            std::cout << "🎛️  [presets] saved '" << name << "' (mode="
                      << bundle["mode"].get<std::string>() << ")" << std::endl;
            res.set_content(json({
                {"name", name}, {"preset", bundle}, {"persisted", persisted}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [presets PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    svr.Delete(R"(/api/presets/([A-Za-z0-9_\-]+))",
               [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        bool removed = false;
        {
            std::lock_guard<std::mutex> lk(st.presets_mutex);
            removed = st.presets.erase(name) > 0;
        }
        if (removed) {
            std::lock_guard<std::mutex> lk(st.modes_config_mutex);
            coordinator_persist_modes_locked(st);
            std::cout << "🗑️  [presets] removed '" << name << "'" << std::endl;
        }
        res.set_content(json({{"name", name}, {"removed", removed}}).dump(),
                        "application/json");
    });

    // POST /api/presets/<name>/apply — copy preset into st.modes_config[<mode>],
    // set that mode active, and persist. Idempotent.
    svr.Post(R"(/api/presets/([A-Za-z0-9_\-]+)/apply)",
             [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        json bundle;
        {
            std::lock_guard<std::mutex> lk(st.presets_mutex);
            if (!st.presets.contains(name)) {
                res.status = 404;
                res.set_content(json({{"error","unknown preset"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            bundle = st.presets[name];
        }
        const std::string mode_name = bundle.value("mode", std::string(""));
        if (mode_name.empty() || !modes::get(mode_name)) {
            res.status = 400;
            res.set_content(json({{"error","preset references unknown mode"},
                                   {"mode",mode_name}}).dump(),
                            "application/json");
            return;
        }
        // Build per-mode block from preset, validating agent names.
        std::set<std::string> active_names;
        for (const auto& a : st.agents) active_names.insert(a.name);
        json block = json::object();
        json unknown = json::array();
        if (bundle.contains("agents") && bundle["agents"].is_array()) {
            json kept = json::array();
            for (const auto& it : bundle["agents"]) {
                if (!it.is_string()) continue;
                const std::string n = it.get<std::string>();
                if (active_names.count(n)) kept.push_back(n);
                else unknown.push_back(n);
            }
            if (!kept.empty()) block["agents"] = kept;
        }
        if (bundle.contains("synthesizer") && bundle["synthesizer"].is_string()) {
            const std::string sn = bundle["synthesizer"].get<std::string>();
            if (active_names.count(sn)) block["synthesizer"] = sn;
            else unknown.push_back(sn);
        }
        if (bundle.contains("max_select") && bundle["max_select"].is_number_integer()) {
            block["max_select"] = bundle["max_select"];
        }
        bool persisted = false;
        {
            std::lock_guard<std::mutex> lk(st.modes_config_mutex);
            // Preserve any non-roster fields (e.g. router.classifier) by merging.
            if (!st.modes_config.contains(mode_name) || !st.modes_config[mode_name].is_object()) {
                st.modes_config[mode_name] = json::object();
            }
            // Drop fields the preset owns so a smaller preset doesn't inherit
            // stale st.agents/synthesizer/max_select from a previous edit.
            st.modes_config[mode_name].erase("agents");
            st.modes_config[mode_name].erase("synthesizer");
            st.modes_config[mode_name].erase("max_select");
            for (auto it = block.begin(); it != block.end(); ++it) {
                st.modes_config[mode_name][it.key()] = it.value();
            }
            persisted = coordinator_persist_modes_locked(st);
        }
        modes::set_active(mode_name);
        std::cout << "🎛️  [presets] applied '" << name << "' → mode="
                  << mode_name << std::endl;
        res.set_content(json({
            {"name", name}, {"mode", mode_name},
            {"applied", block}, {"unknown", unknown},
            {"persisted", persisted}
        }).dump(), "application/json");
    });
}
