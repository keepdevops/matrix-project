#include "pressure_snapshot_llama.h"
#include "httplib.h"

#include <algorithm>
#include <iostream>

using json = nlohmann::json;

double pressure_parse_metric(const std::string& body, const std::string& key) {
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

json pressure_query_llama_port(const PortInfo& info) {
    json out = {
        {"port", info.port},
        {"names", info.names},
        {"backend", "llama"},
        {"ok", false},
        {"usage", nullptr},
        {"kv_used", nullptr},
        {"kv_total", nullptr},
        {"slots_busy", 0},
        {"slots_total", 0},
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

    long kv_used = 0;
    int busy = 0;
    int slot_count = 0;
    bool slots_ok = false;
    bool kv_field_seen = false;
    if (auto r = cli.Get("/slots"); r && r->status == 200) {
        try {
            auto j = json::parse(r->body);
            if (j.is_array()) {
                slots_ok = true;
                for (const auto& s : j) {
                    ++slot_count;
                    bool processing = s.value("is_processing", false);
                    long c = s.value("cache_tokens", -1L);
                    if (c < 0) c = s.value("n_past", -1L);
                    if (c >= 0) kv_field_seen = true;
                    if (c < 0 && processing
                        && s.contains("next_token") && s["next_token"].is_array()) {
                        kv_field_seen = true;
                        long acc = 0;
                        for (const auto& nt : s["next_token"]) {
                            acc += nt.value("n_decoded", 0L);
                        }
                        c = acc;
                    }
                    if (c > 0) kv_used += c;
                    if (processing) ++busy;
                }
            }
        } catch (const std::exception& e) {
            std::cerr << "⚠️  [pressure:" << info.port << "] /slots parse: " << e.what() << std::endl;
        }
    }
    if (slot_count > 0) total_slots = slot_count;

    double metric_ratio = -1.0;
    long metric_tokens = -1;
    if (auto r = cli.Get("/metrics"); r && r->status == 200) {
        metric_ratio = pressure_parse_metric(r->body, "llamacpp:kv_cache_usage_ratio");
        double t = pressure_parse_metric(r->body, "llamacpp:kv_cache_tokens");
        if (t >= 0) metric_tokens = static_cast<long>(t);
        if (!slots_ok) {
            double rp = pressure_parse_metric(r->body, "llamacpp:requests_processing");
            if (rp >= 0) busy = static_cast<int>(rp);
        }
        double dec = pressure_parse_metric(r->body, "llamacpp:n_decode_total");
        if (dec >= 0) out["n_decode_total"] = dec;
        double pp = pressure_parse_metric(r->body, "llamacpp:prompt_tokens_total");
        if (pp >= 0) out["prompt_tokens_total"] = pp;
        double tp = pressure_parse_metric(r->body, "llamacpp:tokens_predicted_total");
        if (tp >= 0) out["tokens_predicted_total"] = tp;
        double drafted = pressure_parse_metric(r->body, "llamacpp:n_drafted_total");
        double accepted = pressure_parse_metric(r->body, "llamacpp:n_drafted_accepted_total");
        if (accepted < 0) accepted = pressure_parse_metric(r->body, "llamacpp:n_accepted_total");
        if (drafted >= 0)  out["n_drafted_total"]  = drafted;
        if (accepted >= 0) out["n_accepted_total"] = accepted;
        if (drafted > 0 && accepted >= 0) {
            out["draft_acceptance_rate"] = accepted / drafted;
        }
    }

    double tp = out.value("tokens_predicted_total", -1.0);
    double nd = out.value("n_decode_total", -1.0);
    if (tp > 0 && nd > 0) {
        double tokens_per_decode = tp / nd;
        out["tokens_per_decode"] = tokens_per_decode;
        if (info.draft_max > 0 && !out.contains("draft_acceptance_rate")) {
            double eff = (tokens_per_decode - 1.0)
                         / static_cast<double>(info.draft_max);
            if (eff < 0.0) eff = 0.0;
            if (eff > 1.0) eff = 1.0;
            out["draft_efficiency"] = eff;
        }
    }

    long kv_total = n_ctx * std::max(total_slots, 1);
    if (!slots_ok && metric_tokens >= 0) kv_used = metric_tokens;

    double usage = -1.0;
    if (slots_ok && kv_total > 0) {
        usage = static_cast<double>(kv_used) / static_cast<double>(kv_total);
    } else if (metric_ratio >= 0) {
        usage = metric_ratio;
        if (kv_total > 0 && metric_tokens < 0) {
            kv_used = static_cast<long>(metric_ratio * kv_total);
        }
    }

    if (slots_ok && total_slots > 0 && !kv_field_seen && metric_ratio < 0) {
        double busy_ratio = static_cast<double>(busy) / static_cast<double>(total_slots);
        if (busy_ratio > usage) usage = busy_ratio;
    }

    if (usage >= 0) {
        out["ok"] = true;
        out["usage"] = usage;
        out["kv_used"] = kv_used;
        out["kv_total"] = kv_total;
        out["slots_busy"] = busy;
        out["slots_total"] = total_slots;
    } else {
        out["error"] = "no /slots and no /metrics available; restart llama-server with --metrics --slots";
    }
    return out;
}
