#include "pressure.h"
#include "json.hpp"
#include "mlx_inflight.h"

#include <algorithm>
#include <future>
#include <iostream>
#include <map>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

struct PortInfo {
    int port;
    std::vector<std::string> names;
    int draft_max = 0;  // 0 = no speculative decoding configured for this port
};

// Parse a Prometheus-format value for the given metric name. Returns -1 if
// the metric is absent or unparseable. Handles "<key> <value>" and
// "<key>{labels} <value>".
double parse_metric(const std::string& body, const std::string& key) {
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

json query_port(const PortInfo& info) {
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

    // /props — context size and slot count
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

    // /slots — authoritative live KV occupancy per slot
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
                        // Newer llama-server: per-turn decode count under next_token[0].n_decoded.
                        // This field is cumulative for the slot's last task and is NOT cleared
                        // by ?action=erase, so only trust it while the slot is actively decoding.
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

    // /metrics — fallback for KV when /slots is disabled, plus throughput
    double metric_ratio = -1.0;
    long metric_tokens = -1;
    if (auto r = cli.Get("/metrics"); r && r->status == 200) {
        metric_ratio = parse_metric(r->body, "llamacpp:kv_cache_usage_ratio");
        double t = parse_metric(r->body, "llamacpp:kv_cache_tokens");
        if (t >= 0) metric_tokens = static_cast<long>(t);
        if (!slots_ok) {
            double rp = parse_metric(r->body, "llamacpp:requests_processing");
            if (rp >= 0) busy = static_cast<int>(rp);
        }
        double dec = parse_metric(r->body, "llamacpp:n_decode_total");
        if (dec >= 0) out["n_decode_total"] = dec;
        double pp = parse_metric(r->body, "llamacpp:prompt_tokens_total");
        if (pp >= 0) out["prompt_tokens_total"] = pp;
        double tp = parse_metric(r->body, "llamacpp:tokens_predicted_total");
        if (tp >= 0) out["tokens_predicted_total"] = tp;
        // Speculative decoding metrics — only present when llama-server was
        // launched with --model-draft. n_accepted / n_drafted is the win
        // ratio: <=1.0; >0.5 typically means the draft model is helping.
        double drafted = parse_metric(r->body, "llamacpp:n_drafted_total");
        double accepted = parse_metric(r->body, "llamacpp:n_drafted_accepted_total");
        if (accepted < 0) accepted = parse_metric(r->body, "llamacpp:n_accepted_total");
        if (drafted >= 0)  out["n_drafted_total"]  = drafted;
        if (accepted >= 0) out["n_accepted_total"] = accepted;
        if (drafted > 0 && accepted >= 0) {
            out["draft_acceptance_rate"] = accepted / drafted;
        }
    }

    // Build-portable fallback: when n_drafted/n_accepted aren't exposed
    // (older llama.cpp builds — most do not emit these), derive an
    // effective signal from the always-present tokens_predicted_total /
    // n_decode_total ratio. With speculative decoding off, each decode call
    // emits exactly 1 token (tokens_per_decode == 1.0). With spec on and
    // perfect acceptance it emits draft_max+1. draft_efficiency normalizes
    // to [0, 1]: ~0 = draft contributing nothing, ~1 = perfect acceptance.
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

    // When the server build doesn't expose KV occupancy at all (no cache_tokens,
    // n_past, next_token, or kv_cache_usage_ratio anywhere), fall back to the
    // slot-concurrency ratio so the gauge still reflects live compute pressure.
    // Don't apply this when we have a real KV signal — otherwise a single busy
    // slot would peg single-slot ports to 100% regardless of actual occupancy.
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

// MLX has no /metrics or /slots. Treat it as a serialized backend with one
// effective slot, and use the coordinator-side inflight counter (queued +
// active) as the pressure proxy. QUEUE_FULL is the queue depth at which the
// gauge reads 100%.
constexpr int MLX_QUEUE_FULL = 4;

json mlx_entry(const PortInfo& info) {
    int pending = mlx_inflight::get(info.port);
    int busy = pending > 0 ? 1 : 0;
    int queue_depth = std::max(0, pending - 1);

    double avg_secs = mlx_inflight::avg_decode_secs(info.port);
    double avg_tps  = mlx_inflight::avg_decode_tps(info.port);

    // Asymptotic, never-saturating fallback usage so the legacy single-bar
    // gauge keeps moving as the queue drains. Real signal lives in the four
    // fields below — UI should prefer those for the cluster-of-gauges view.
    double usage = static_cast<double>(pending) /
                   static_cast<double>(pending + MLX_QUEUE_FULL);

    // Estimated wait until a freshly arriving request begins decode.
    // Uses measured EMA when available; null when no samples yet.
    json expected_wait = nullptr;
    if (avg_secs > 0.0) {
        expected_wait = queue_depth * avg_secs;
    }

    return json{
        {"port", info.port},
        {"names", info.names},
        {"backend", "mlx"},
        {"ok", true},
        {"usage", usage},
        {"kv_used", nullptr},
        {"kv_total", nullptr},
        {"slots_busy", busy},
        {"slots_total", 1},
        {"queue_depth", queue_depth},
        {"pending", pending},
        {"decode_rate_tps", avg_tps > 0.0 ? json(avg_tps) : json(nullptr)},
        {"avg_request_secs", avg_secs > 0.0 ? json(avg_secs) : json(nullptr)},
        {"expected_wait_secs", expected_wait},
    };
}

}  // namespace

json snapshot_pressure(const std::vector<Agent>& agents) {
    std::map<int, PortInfo> llama_by_port;
    std::map<int, PortInfo> mlx_by_port;
    for (const auto& a : agents) {
        if (a.engine == "llama") {
            auto& p = llama_by_port[a.port];
            p.port = a.port;
            p.names.push_back(a.name);
            if (p.draft_max == 0 && a.draft_max > 0) p.draft_max = a.draft_max;
        } else if (a.engine == "mlx") {
            auto& p = mlx_by_port[a.port];
            p.port = a.port;
            p.names.push_back(a.name);
        }
    }

    std::vector<std::future<json>> futs;
    futs.reserve(llama_by_port.size());
    for (const auto& kv : llama_by_port) {
        const PortInfo info = kv.second;
        futs.push_back(std::async(std::launch::async,
            [info]() { return query_port(info); }));
    }

    json arr = json::array();
    for (auto& f : futs) {
        try { arr.push_back(f.get()); }
        catch (const std::exception& e) {
            std::cerr << "❌ [pressure] worker failed: " << e.what() << std::endl;
        }
    }
    for (const auto& kv : mlx_by_port) {
        arr.push_back(mlx_entry(kv.second));
    }
    return arr;
}

void register_pressure_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents) {
    svr.Get("/api/pressure", [&agents](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        res.set_content(snapshot_pressure(agents).dump(), "application/json");
    });
}
