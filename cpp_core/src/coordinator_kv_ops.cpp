#include "coordinator_kv_ops.h"
#include "httplib.h"

#include <future>
#include <iostream>
#include <map>

using json = nlohmann::json;

namespace coordinator_kv_ops {

std::map<int, int> agent_port_slots(const std::vector<Agent>& agents) {
    std::map<int, int> port_slots;
    for (const auto& a : agents) port_slots[a.port]++;
    return port_slots;
}

std::map<int, std::string> clear_kv_on_ports(const std::map<int, int>& port_slots) {
    std::vector<std::future<std::pair<int, std::string>>> futures;
    for (const auto& kv : port_slots) {
        int port = kv.first;
        int slot_count = kv.second;
        futures.push_back(std::async(std::launch::async, [port, slot_count]() {
            std::string result;
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(10);
                bool all_ok = true;
                for (int s = 0; s < slot_count; ++s) {
                    auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase",
                                     "", "application/json");
                    if (!r || r->status != 200) all_ok = false;
                }
                result = all_ok ? "cleared" : "partial";
            } catch (const std::exception& e) {
                std::cerr << "❌ KV clear error on port " << port
                          << ": " << e.what() << std::endl;
                result = std::string("error: ") + e.what();
            }
            return std::make_pair(port, result);
        }));
    }

    std::map<int, std::string> port_results;
    for (auto& fut : futures) {
        auto pr = fut.get();
        port_results[pr.first] = pr.second;
        std::cout << "  port " << pr.first << ": " << pr.second << std::endl;
    }
    return port_results;
}

json evict_slots_on_ports(const std::map<int, int>& port_slots) {
    std::vector<std::future<std::pair<int, json>>> futures;
    for (const auto& kv : port_slots) {
        int port = kv.first, slot_count = kv.second;
        futures.push_back(std::async(std::launch::async, [port, slot_count]() {
            json result;
            result["slots_attempted"] = slot_count;
            int ok = 0;
            try {
                httplib::Client cli("127.0.0.1", port);
                cli.set_connection_timeout(5);
                cli.set_read_timeout(10);
                for (int s = 0; s < slot_count; ++s) {
                    auto r = cli.Post("/slots/" + std::to_string(s) + "?action=erase",
                                     "", "application/json");
                    if (r && r->status == 200) ++ok;
                }
                result["slots_cleared"] = ok;
                result["status"] = (ok == slot_count) ? "ok" : "partial";
            } catch (const std::exception& e) {
                std::cerr << "❌ [evict] port " << port << ": " << e.what() << std::endl;
                result["status"] = std::string("error: ") + e.what();
                result["slots_cleared"] = ok;
            }
            return std::make_pair(port, result);
        }));
    }

    json ports_out = json::object();
    for (auto& fut : futures) {
        auto pr = fut.get();
        ports_out[std::to_string(pr.first)] = pr.second;
    }
    return ports_out;
}

}  // namespace coordinator_kv_ops
