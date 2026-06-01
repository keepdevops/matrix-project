#pragma once
// Inline metric-line parser and slot/metrics response parsers for pressure_snapshot_llama.cpp.

#include "json.hpp"
#include <iostream>
#include <string>

using json = nlohmann::json;

inline double pressure_parse_metric(const std::string& body, const std::string& key) {
    size_t pos = 0;
    while (pos < body.size()) {
        size_t end = body.find('\n', pos);
        std::string line = body.substr(pos, (end == std::string::npos) ? body.size() - pos : end - pos);
        pos = (end == std::string::npos) ? body.size() : end + 1;
        if (line.empty() || line[0] == '#') continue;
        if (line.compare(0, key.size(), key) != 0) continue;
        char nxt = line.size() > key.size() ? line[key.size()] : '\0';
        if (nxt != ' ' && nxt != '\t' && nxt != '{') continue;
        size_t sp = line.find(' ', key.size());
        if (sp == std::string::npos) continue;
        try {
            return std::stod(line.substr(sp + 1));
        } catch (const std::exception& e) {
            std::cerr << "⚠️  [pressure] parse_metric(" << key << "): " << e.what() << std::endl;
            return -1.0;
        }
    }
    return -1.0;
}

struct SlotsResult {
    long kv_used = 0;
    int busy = 0;
    int slot_count = 0;
    bool slots_ok = false;
    bool kv_field_seen = false;
};

inline SlotsResult parse_slots_response(const std::string& body, int port) {
    SlotsResult r;
    try {
        auto j = json::parse(body);
        if (!j.is_array()) return r;
        r.slots_ok = true;
        for (const auto& s : j) {
            ++r.slot_count;
            bool processing = s.value("is_processing", false);
            long c = s.value("cache_tokens", -1L);
            if (c < 0) c = s.value("n_past", -1L);
            if (c >= 0) r.kv_field_seen = true;
            if (c < 0 && processing
                && s.contains("next_token") && s["next_token"].is_array()) {
                r.kv_field_seen = true;
                long acc = 0;
                for (const auto& nt : s["next_token"])
                    acc += nt.value("n_decoded", 0L);
                c = acc;
            }
            if (c > 0) r.kv_used += c;
            if (processing) ++r.busy;
        }
    } catch (const std::exception& e) {
        std::cerr << "⚠️  [pressure:" << port << "] /slots parse: " << e.what() << std::endl;
    }
    return r;
}

struct MetricsResult {
    double metric_ratio  = -1.0;
    long   metric_tokens = -1;
    int    busy_override = -1;
};

inline MetricsResult parse_metrics_response(const std::string& body, json& out) {
    MetricsResult r;
    r.metric_ratio = pressure_parse_metric(body, "llamacpp:kv_cache_usage_ratio");
    double t = pressure_parse_metric(body, "llamacpp:kv_cache_tokens");
    if (t >= 0) r.metric_tokens = static_cast<long>(t);
    double rp = pressure_parse_metric(body, "llamacpp:requests_processing");
    if (rp >= 0) r.busy_override = static_cast<int>(rp);
    double dec = pressure_parse_metric(body, "llamacpp:n_decode_total");
    if (dec >= 0) out["n_decode_total"] = dec;
    double pp = pressure_parse_metric(body, "llamacpp:prompt_tokens_total");
    if (pp >= 0) out["prompt_tokens_total"] = pp;
    double tp = pressure_parse_metric(body, "llamacpp:tokens_predicted_total");
    if (tp >= 0) out["tokens_predicted_total"] = tp;
    double drafted  = pressure_parse_metric(body, "llamacpp:n_drafted_total");
    double accepted = pressure_parse_metric(body, "llamacpp:n_drafted_accepted_total");
    if (accepted < 0) accepted = pressure_parse_metric(body, "llamacpp:n_accepted_total");
    if (drafted  >= 0) out["n_drafted_total"]  = drafted;
    if (accepted >= 0) out["n_accepted_total"] = accepted;
    if (drafted > 0 && accepted >= 0) out["draft_acceptance_rate"] = accepted / drafted;
    return r;
}
