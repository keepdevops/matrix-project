#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

// Handles PUT /api/modes/<name>/agents. Extracted from coordinator_routes_modes.cpp
// to keep each file under 300 LOC.
void handle_mode_agents_put(CoordinatorState& st,
                             const std::string& mode_name,
                             const httplib::Request& req,
                             httplib::Response& res)
{
    try {
        auto body = json::parse(req.body);
        const bool has_agents  = body.contains("agents") && body["agents"].is_array();
        const bool has_max     = body.contains("max_select") && body["max_select"].is_number_integer();
        const bool has_synth   = body.contains("synthesizer")
                                 && (body["synthesizer"].is_string() || body["synthesizer"].is_null());
        const bool has_variant = body.contains("variant_policy")
                                 && (body["variant_policy"].is_string() || body["variant_policy"].is_null());
        const bool has_preset  = body.contains("preset")
                                 && (body["preset"].is_string() || body["preset"].is_null());
        const bool has_synth_policy = body.contains("synthesis_policy")
                                 && (body["synthesis_policy"].is_string() || body["synthesis_policy"].is_null());
        const bool has_classifier_policy = body.contains("classifier_policy")
                                 && (body["classifier_policy"].is_string() || body["classifier_policy"].is_null());
        const bool has_stage_context = body.contains("stage_context_chars")
                                 && body["stage_context_chars"].is_number_integer();
        const bool has_order   = body.contains("order")
                                 && (body["order"].is_array() || body["order"].is_null());
        if (has_order && mode_name != "pipeline") {
            res.status = 400;
            res.set_content(json({{"error","order is only supported for pipeline mode"}}).dump(),
                            "application/json");
            return;
        }
        if (!has_agents && !has_max && !has_synth && !has_variant && !has_preset
            && !has_synth_policy && !has_classifier_policy && !has_stage_context && !has_order) {
            res.status = 400;
            res.set_content(json({{"error","provide agents, max_select, synthesizer, mode policy, or order"}}).dump(),
                            "application/json");
            return;
        }
        std::set<std::string> active_names;
        for (const auto& a : st.agents) active_names.insert(a.name);
        json normalized = json::array();
        json unknown = json::array();
        std::set<std::string> normalized_seen;
        size_t requested_count = 0;
        if (has_agents) {
            for (const auto& item : body["agents"]) {
                if (!item.is_string()) continue;
                ++requested_count;
                const std::string n = item.get<std::string>();
                if (active_names.count(n)) {
                    if (mode_name == "pipeline" || normalized_seen.insert(n).second)
                        normalized.push_back(n);
                } else {
                    unknown.push_back(n);
                }
            }
        }
        if (has_agents && requested_count > 0 && normalized.empty()) {
            res.status = 409;
            res.set_content(json({
                {"error","all requested agents unknown — refusing to erase roster"},
                {"mode", mode_name}, {"unknown", unknown},
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
            if (!st.modes_config.contains(mode_name) || !st.modes_config[mode_name].is_object())
                st.modes_config[mode_name] = json::object();
            if (has_agents) st.modes_config[mode_name]["agents"] = normalized;
            if (has_max)    st.modes_config[mode_name]["max_select"] = max_select_val;
            if (has_synth) {
                if (body["synthesizer"].is_null() || body["synthesizer"].get<std::string>().empty()) {
                    st.modes_config[mode_name].erase("synthesizer");
                } else {
                    const std::string sn = body["synthesizer"].get<std::string>();
                    if (active_names.count(sn)) st.modes_config[mode_name]["synthesizer"] = sn;
                    else unknown_synth_name = sn;
                }
            }
            auto apply_string_option = [&](const char* key, bool present) {
                if (!present) return;
                if (body[key].is_null() || body[key].get<std::string>().empty())
                    st.modes_config[mode_name].erase(key);
                else
                    st.modes_config[mode_name][key] = body[key].get<std::string>();
            };
            apply_string_option("variant_policy", has_variant);
            apply_string_option("preset", has_preset);
            apply_string_option("synthesis_policy", has_synth_policy);
            apply_string_option("classifier_policy", has_classifier_policy);
            if (has_stage_context) {
                int v = body["stage_context_chars"].get<int>();
                if (v < 0) v = 0;
                st.modes_config[mode_name]["stage_context_chars"] = v;
            }
            if (has_order && mode_name == "pipeline") {
                if (body["order"].is_null()) {
                    st.modes_config[mode_name].erase("order");
                } else {
                    json normalized_order = json::array();
                    for (const auto& item : body["order"]) {
                        if (!item.is_string()) continue;
                        const std::string n = item.get<std::string>();
                        if (active_names.count(n)) normalized_order.push_back(n);
                    }
                    if (normalized_order.empty()) st.modes_config[mode_name].erase("order");
                    else st.modes_config[mode_name]["order"] = normalized_order;
                }
            }
            persisted = coordinator_persist_modes_locked(st);
        }
        std::cout << "🧩 [modes/" << mode_name << "/agents] "
                  << (has_agents ? std::to_string(normalized.size()) + " agent(s) " : "")
                  << (has_max ? "max_select=" + std::to_string(max_select_val) : "")
                  << (persisted ? "" : " (persistence FAILED)") << std::endl;
        json out = {
            {"mode", mode_name}, {"agents", normalized}, {"unknown", unknown},
            {"unknown_synthesizer", unknown_synth_name.empty() ? json(nullptr) : json(unknown_synth_name)},
            {"persisted", persisted}
        };
        if (has_max)              out["max_select"]         = max_select_val;
        if (has_variant)          out["variant_policy"]     = body["variant_policy"];
        if (has_preset)           out["preset"]             = body["preset"];
        if (has_synth_policy)     out["synthesis_policy"]   = body["synthesis_policy"];
        if (has_classifier_policy) out["classifier_policy"] = body["classifier_policy"];
        if (has_stage_context)    out["stage_context_chars"]= body["stage_context_chars"];
        if (has_order && mode_name == "pipeline") {
            if (body["order"].is_null()) {
                out["order"] = nullptr;
            } else {
                json normalized_order = json::array();
                json unknown_order = json::array();
                std::set<std::string> active_names_out;
                for (const auto& a : st.agents) active_names_out.insert(a.name);
                for (const auto& item : body["order"]) {
                    if (!item.is_string()) continue;
                    const std::string n = item.get<std::string>();
                    if (active_names_out.count(n)) normalized_order.push_back(n);
                    else unknown_order.push_back(n);
                }
                out["order"] = normalized_order;
                if (!unknown_order.empty()) out["unknown_order"] = unknown_order;
            }
        }
        if (!has_agents) {
            std::lock_guard<std::mutex> lock(st.modes_config_mutex);
            if (st.modes_config.contains(mode_name)
                && st.modes_config[mode_name].contains("agents")
                && st.modes_config[mode_name]["agents"].is_array()) {
                out["agents"] = st.modes_config[mode_name]["agents"];
            }
        }
        res.set_content(out.dump(), "application/json");
    } catch (const std::exception& e) {
        std::cerr << "❌ [modes/agents PUT] " << e.what() << std::endl;
        res.status = 400;
        res.set_content(json({{"error", e.what()}}).dump(), "application/json");
    }
}
