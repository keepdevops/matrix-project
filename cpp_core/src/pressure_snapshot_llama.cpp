#include "pressure_snapshot_llama.h"
#include "pressure_snapshot_llama_parse.h"
#include "httplib.h"

#include <algorithm>
#include <iostream>

json pressure_query_llama_port(const PortInfo& info) {
    json out = {
        {"port", info.port}, {"names", info.names}, {"backend", "llama"},
        {"ok", false}, {"usage", nullptr},
        {"kv_used", nullptr}, {"kv_total", nullptr},
        {"slots_busy", 0}, {"slots_total", 0},
    };

    httplib::Client cli("127.0.0.1", info.port);
    cli.set_connection_timeout(2);
    cli.set_read_timeout(3);

    long n_ctx = 0;
    int total_slots = 0;

    if (auto r = cli.Get("/props"); r && r->status == 200) {
        try {
            auto j = json::parse(r->body);
            total_slots = j.value("total_slots", 0);
            if (j.contains("default_generation_settings") &&
                j["default_generation_settings"].is_object()) {
                n_ctx = j["default_generation_settings"].value("n_ctx", 0);
            }
            if (n_ctx == 0) n_ctx = j.value("n_ctx", 0);
        } catch (const std::exception& e) {
            std::cerr << "⚠️  [pressure:" << info.port << "] /props parse: " << e.what() << std::endl;
        }
    }

    SlotsResult sr;
    if (auto r = cli.Get("/slots"); r && r->status == 200)
        sr = parse_slots_response(r->body, info.port);
    if (sr.slot_count > 0) total_slots = sr.slot_count;

    MetricsResult mr;
    if (auto r = cli.Get("/metrics"); r && r->status == 200) {
        mr = parse_metrics_response(r->body, out);
        if (!sr.slots_ok && mr.busy_override >= 0) sr.busy = mr.busy_override;
    }

    double tp = out.value("tokens_predicted_total", -1.0);
    double nd = out.value("n_decode_total", -1.0);
    if (tp > 0 && nd > 0) {
        double tokens_per_decode = tp / nd;
        out["tokens_per_decode"] = tokens_per_decode;
        if (info.draft_max > 0 && !out.contains("draft_acceptance_rate")) {
            double eff = (tokens_per_decode - 1.0) / static_cast<double>(info.draft_max);
            if (eff < 0.0) eff = 0.0;
            if (eff > 1.0) eff = 1.0;
            out["draft_efficiency"] = eff;
        }
    }

    long kv_total = n_ctx * std::max(total_slots, 1);
    long kv_used  = sr.kv_used;
    if (!sr.slots_ok && mr.metric_tokens >= 0) kv_used = mr.metric_tokens;

    double usage = -1.0;
    if (sr.slots_ok && kv_total > 0) {
        usage = static_cast<double>(kv_used) / static_cast<double>(kv_total);
    } else if (mr.metric_ratio >= 0) {
        usage = mr.metric_ratio;
        if (kv_total > 0 && mr.metric_tokens < 0)
            kv_used = static_cast<long>(mr.metric_ratio * kv_total);
    }

    if (sr.slots_ok && total_slots > 0 && !sr.kv_field_seen && mr.metric_ratio < 0) {
        double busy_ratio = static_cast<double>(sr.busy) / static_cast<double>(total_slots);
        if (busy_ratio > usage) usage = busy_ratio;
    }

    if (usage >= 0) {
        out["ok"]          = true;
        out["usage"]       = usage;
        out["kv_used"]     = kv_used;
        out["kv_total"]    = kv_total;
        out["slots_busy"]  = sr.busy;
        out["slots_total"] = total_slots;
    } else {
        out["error"] = "no /slots and no /metrics available; restart llama-server with --metrics --slots";
    }
    return out;
}
