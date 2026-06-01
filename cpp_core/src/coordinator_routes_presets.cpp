#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"
#include "coordinator_routes_presets_impl.h"
#include "coordinator_routes_presets_url.h"

void register_coordinator_routes_presets(httplib::Server& svr, CoordinatorState& st) {
    presets_url::register_get_delete_routes(svr, st);

    svr.Put(R"(/api/presets/([^/]+))",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = presets_url::decode(req.matches[1]);
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
            if (body.contains("agents") && body["agents"].is_array())
                bundle["agents"] = body["agents"];
            if (body.contains("synthesizer") && body["synthesizer"].is_string()
                && !body["synthesizer"].get<std::string>().empty())
                bundle["synthesizer"] = body["synthesizer"];
            if (body.contains("max_select") && body["max_select"].is_number_integer())
                bundle["max_select"] = body["max_select"];
            bool persisted = false;
            { std::lock_guard<std::mutex> lk(st.presets_mutex); st.presets[name] = bundle; }
            { std::lock_guard<std::mutex> lk(st.modes_config_mutex);
              persisted = coordinator_persist_modes_locked(st); }
            std::cout << "🎛️  [presets] saved '" << name << "' (mode="
                      << bundle["mode"].get<std::string>() << ")" << std::endl;
            res.set_content(json({{"name",name},{"preset",bundle},{"persisted",persisted}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [presets PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    svr.Post(R"(/api/presets/([^/]+)/apply)",
             [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = presets_url::decode(req.matches[1]);
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
                                   {"mode",mode_name}}).dump(), "application/json");
            return;
        }
        std::set<std::string> active_names;
        for (const auto& a : st.agents) active_names.insert(a.name);
        auto ap = presets_impl::build_apply_block(bundle, active_names);
        bool persisted = presets_impl::merge_and_persist(st, mode_name, ap.block);
        modes::set_active(mode_name);
        std::cout << "🎛️  [presets] applied '" << name << "' → mode=" << mode_name << std::endl;
        res.set_content(json({{"name",name},{"mode",mode_name},
            {"applied",ap.block},{"unknown",ap.unknown},{"persisted",persisted}
        }).dump(), "application/json");
    });
}
