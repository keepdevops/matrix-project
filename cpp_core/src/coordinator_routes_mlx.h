#pragma once
#ifdef MATRIX_MLX_NATIVE_COORD

#include "coordinator_context.h"
#include "httplib.h"

#include <map>
#include <mutex>

// MS-132: per-port serialisation — mlx_lm.server is single-threaded per port.
// Acquire before every HTTP call to a port; released on return.
// Lives here (inline) so MS-133+ route implementations can use it without
// needing a separate TU or linking step.
namespace mlx_coordinator {

inline std::mutex& port_mutex(int port) {
    static std::mutex registry_mu;
    static std::map<int, std::mutex> mutexes;
    std::lock_guard<std::mutex> lk(registry_mu);
    return mutexes[port];  // default-constructs on first access
}

}  // namespace mlx_coordinator

// Register all /api/mlx/* routes on svr.
// Stubs return 501 until the respective MS-133+ issues implement them.
void register_coordinator_routes_mlx(httplib::Server& svr, CoordinatorState& st);

#endif  // MATRIX_MLX_NATIVE_COORD
