#include "pressure_evict_score.h"
#include "httplib.h"

#include <algorithm>
#include <iostream>
#include <string>

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

json evict_port(int port, double threshold, long min_kv_tokens,
                bool force, bool dry_run) {
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
        if (ctoks < min_kv_tokens) { out["slots_skipped_small"].push_back(id); continue; }
        if (dry_run) {
            out["slots_evicted"].push_back({{"id", id}, {"cache_tokens", ctoks}});
            continue;
        }
        auto r = cli.Post("/slots/" + std::to_string(id) + "?action=erase",
                          "", "application/json");
        if (r && r->status == 200) {
            out["slots_evicted"].push_back({{"id", id}, {"cache_tokens", ctoks}});
        } else {
            out["slots_evict_failed"].push_back({{"id", id}, {"cache_tokens", ctoks},
                                                 {"status", r ? r->status : -1}});
        }
    }
    return out;
}
