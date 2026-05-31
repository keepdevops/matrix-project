#include "pressure_snapshot_llama.h"
#include "mlx_inflight.h"

#include <algorithm>

using json = nlohmann::json;

namespace {

constexpr int MLX_QUEUE_FULL = 4;

}  // namespace

json pressure_mlx_entry(const PortInfo& info) {
    int pending = mlx_inflight::get(info.port);
    int busy = pending > 0 ? 1 : 0;
    int queue_depth = std::max(0, pending - 1);

    double avg_secs = mlx_inflight::avg_decode_secs(info.port);
    double avg_tps  = mlx_inflight::avg_decode_tps(info.port);

    double usage = static_cast<double>(pending) /
                   static_cast<double>(pending + MLX_QUEUE_FULL);

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
