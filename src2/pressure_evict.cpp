#include "pressure.h"
#include "json.hpp"

#include <algorithm>
#include <future>
#include <iostream>
#include <set>
#include <string>
#include <vector>

using json = nlohmann::json;

namespace {

struct PortState {
    int port = 0;
    int n_ctx = 0;
    int total_slots = 0;
    long kv_used = 0;
    double usage = -1.0;
    // Per-slot: id, cache_tokens, is_processing
    std::vector<std::tuple<int, long, bool>> slots;
    bool ok = false;
    std::string error;
};

PortState read_port_state(int port) {
    PortState st;
    st.port = port;
    httplib::Client cli("127.0.0.1", port);
    cli.set_connection_timeout(2);
    cli.set_read_timeout(3);

    if (auto r = cli.Get("/props"); r && r->status == 200) {
        try {
            auto j = json::parse(r->body);
            st.total_slots = j.value("total_slots", 0);
            if (j.contains("default_generation_settings") &&
                j["default_generation_settings"].is_object()) {
                st.n_ctx = j["default_generation_settings"].value("n_ctx", 0);
            }
            if (st.n_ctx == 0) st.n_ctx = j.value("n_ctx", 0);
        } catch (const std::exception& e) {
            std::cerr << "[evict:" << port << "] /props parse: " << e.what() << std::endl;
        }
    }

    if (auto r = cli.Get("/slots"); r && r->status == 200) {
        try {
            auto j = json::parse(r->body);
            if (j.is_array()) {
                int idx = 0;
                for (const auto& s : j) {
                    int id = s.value("id", idx);
                    long c = s.value("cache_tokens", -1L);
                    if (c < 0) c = s.value("n_past", -1L);
                    bool busy = s.value("is_processing", false);
                    if (c > 0) st.kv_used += c;
                    st.slots.emplace_back(id, std::max(c, 0L), busy);
                    ++idx;
                }
                st.ok = true;
            }
        } catch (const std::exception& e) {
            std::cerr << "[evict:" << port << "] /slots parse: " << e.what() << std::endl;
            st.error = e.what();
        }
    } else {
        st.error = "GET /slots failed";
    }

    long total = static_cast<long>(st.n_ctx)
                 * std::max(st.total_slots, (int)st.slots.size());
    if (total > 0) st.usage = static_cast<double>(st.kv_used) / static_cast<double>(total);
    return st;
}

json evict_port(int port, double threshold, long min_kv_tokens, bool force,
                bool dry_run) {
    json out = {
        {"port", port},
        {"usage_before", nullptr},
        {"slots_evicted", json::array()},
        {"slots_skipped_busy", json::array()},
        {"slots_skipped_small", json::array()},
        {"dry_run", dry_run},
        {"acted", false},
    };
    PortState st = read_port_state(port);
    if (!st.ok) {
        out["error"] = st.error.empty() ? "could not read state" : st.error;
        return out;
    }
    if (st.usage >= 0) out["usage_before"] = st.usage;

    bool over_threshold = st.usage >= 0 && st.usage >= threshold;
    if (!force && !over_threshold) {
        out["reason"] = "below threshold";
        return out;
    }
    out["acted"] = true;

    httplib::Client cli("127.0.0.1", port);
    cli.set_connection_timeout(2);
    cli.set_read_timeout(5);

    for (const auto& tup : st.slots) {
        int id = std::get<0>(tup);
        long ctoks = std::get<1>(tup);
        bool busy = std::get<2>(tup);
        if (busy) { out["slots_skipped_busy"].push_back(id); continue; }
        if (ctoks < min_kv_tokens) {
            out["slots_skipped_small"].push_back(id);
            continue;
        }
        if (dry_run) {
            out["slots_evicted"].push_back({{"id", id}, {"cache_tokens", ctoks}});
            continue;
        }
        auto r = cli.Post("/slots/" + std::to_string(id) + "?action=erase",
                         "", "application/json");
        if (r && r->status == 200) {
            out["slots_evicted"].push_back({{"id", id}, {"cache_tokens", ctoks}});
        } else {
            json fail = {{"id", id}, {"cache_tokens", ctoks},
                         {"status", r ? r->status : -1}};
            out["slots_evict_failed"].push_back(fail);
        }
    }
    return out;
}

}  // namespace

void register_eviction_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents) {
    // Snapshot llama ports up front; agent list is static once loaded.
    auto llama_ports = std::make_shared<std::set<int>>();
    for (const auto& a : agents) {
        if (a.engine == "llama") llama_ports->insert(a.port);
    }

    svr.Post("/api/pressure/evict", [llama_ports](const httplib::Request& req,
                                                  httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        double threshold = 0.85;
        long min_kv_tokens = 256;
        int specific_port = -1;
        bool dry_run = false;
        bool force = false;
        if (!req.body.empty()) {
            try {
                auto j = json::parse(req.body);
                threshold = j.value("threshold", threshold);
                min_kv_tokens = j.value("min_kv_tokens", min_kv_tokens);
                specific_port = j.value("port", -1);
                dry_run = j.value("dry_run", false);
                force = j.value("force", false);
            } catch (const std::exception& e) {
                res.status = 400;
                res.set_content(json({{"error", e.what()}}).dump(),
                                "application/json");
                return;
            }
        }

        std::vector<int> targets;
        if (specific_port > 0) {
            if (!llama_ports->count(specific_port)) {
                res.status = 404;
                res.set_content(json({{"error", "unknown llama port"},
                                      {"port", specific_port}}).dump(),
                                "application/json");
                return;
            }
            targets.push_back(specific_port);
            force = true;  // explicit port = honor request regardless of usage
        } else {
            for (int p : *llama_ports) targets.push_back(p);
        }

        std::vector<std::future<json>> futs;
        futs.reserve(targets.size());
        for (int p : targets) {
            futs.push_back(std::async(std::launch::async,
                [p, threshold, min_kv_tokens, force, dry_run]() {
                    return evict_port(p, threshold, min_kv_tokens, force, dry_run);
                }));
        }

        json arr = json::array();
        for (auto& f : futs) {
            try { arr.push_back(f.get()); }
            catch (const std::exception& e) {
                std::cerr << "[evict] worker failed: " << e.what() << std::endl;
            }
        }
        json result = {
            {"threshold", threshold},
            {"min_kv_tokens", min_kv_tokens},
            {"dry_run", dry_run},
            {"ports", arr},
        };
        res.set_content(result.dump(), "application/json");
        std::cout << "[evict] threshold=" << threshold
                  << " ports=" << targets.size()
                  << " dry_run=" << dry_run << std::endl;
    });
}
