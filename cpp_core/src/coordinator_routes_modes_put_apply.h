#pragma once
#include "json.hpp"
#include <set>
#include <string>

using json = nlohmann::json;

namespace modes_put_apply {

inline void apply_string_option(const json& body, json& config,
                                 const char* key, bool present)
{
    if (!present) return;
    if (body[key].is_null() || body[key].get<std::string>().empty())
        config.erase(key);
    else
        config[key] = body[key].get<std::string>();
}

inline void apply_synthesizer(const json& body, json& config,
                               const std::set<std::string>& active_names,
                               std::string& unknown_synth_out)
{
    if (body["synthesizer"].is_null() || body["synthesizer"].get<std::string>().empty()) {
        config.erase("synthesizer");
    } else {
        const std::string sn = body["synthesizer"].get<std::string>();
        if (active_names.count(sn)) config["synthesizer"] = sn;
        else unknown_synth_out = sn;
    }
}

inline void apply_order(const json& body, json& config,
                         const std::string& mode_name,
                         const std::set<std::string>& active_names)
{
    if (mode_name != "pipeline") return;
    if (body["order"].is_null()) {
        config.erase("order");
    } else {
        json normalized_order = json::array();
        for (const auto& item : body["order"]) {
            if (!item.is_string()) continue;
            const std::string n = item.get<std::string>();
            if (active_names.count(n)) normalized_order.push_back(n);
        }
        if (normalized_order.empty()) config.erase("order");
        else config["order"] = normalized_order;
    }
}

} // namespace modes_put_apply
