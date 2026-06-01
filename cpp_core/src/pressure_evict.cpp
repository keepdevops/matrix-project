#include "pressure.h"
#include "pressure_evict_score.h"

#include <future>
#include <iostream>
#include <set>
#include <vector>

void register_eviction_routes(httplib::Server& svr,
                              const std::vector<Agent>& agents) {
    auto llama_ports = std::make_shared<std::set<int>>();
    for (const auto& a : agents) {
        if (a.engine == "llama") llama_ports->insert(a.port);
    }

    svr.Post("/api/pressure/evict", [llama_ports](const httplib::Request& req,
                                                  httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        double threshold    = 0.85;
        long min_kv_tokens  = 256;
        int specific_port   = -1;
        bool dry_run        = false;
        bool force          = false;
        if (!req.body.empty()) {
            try {
                auto j = json::parse(req.body);
                threshold     = j.value("threshold",     threshold);
                min_kv_tokens = j.value("min_kv_tokens", min_kv_tokens);
                specific_port = j.value("port",          -1);
                dry_run       = j.value("dry_run",       false);
                force         = j.value("force",         false);
            } catch (const std::exception& e) {
                res.status = 400;
                res.set_content(json({{"error", e.what()}}).dump(), "application/json");
                return;
            }
        }

        std::vector<int> targets;
        if (specific_port > 0) {
            if (!llama_ports->count(specific_port)) {
                res.status = 404;
                res.set_content(json({{"error", "unknown llama port"},
                                      {"port",  specific_port}}).dump(),
                                "application/json");
                return;
            }
            targets.push_back(specific_port);
            force = true;
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
            {"threshold",     threshold},
            {"min_kv_tokens", min_kv_tokens},
            {"dry_run",       dry_run},
            {"ports",         arr},
        };
        res.set_content(result.dump(), "application/json");
        std::cout << "[evict] threshold=" << threshold
                  << " ports=" << targets.size()
                  << " dry_run=" << dry_run << std::endl;
    });
}
