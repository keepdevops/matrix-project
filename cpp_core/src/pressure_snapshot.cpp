#include "pressure.h"
#include "pressure_snapshot_llama.h"

#include <future>
#include <iostream>
#include <map>
#include <vector>

using json = nlohmann::json;

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
            [info]() { return pressure_query_llama_port(info); }));
    }

    json arr = json::array();
    for (auto& f : futs) {
        try { arr.push_back(f.get()); }
        catch (const std::exception& e) {
            std::cerr << "❌ [pressure] worker failed: " << e.what() << std::endl;
        }
    }
    for (const auto& kv : mlx_by_port) {
        arr.push_back(pressure_mlx_entry(kv.second));
    }
    return arr;
}
