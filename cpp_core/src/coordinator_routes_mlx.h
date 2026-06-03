#pragma once
#ifdef MATRIX_MLX_NATIVE_COORD

#include "coordinator_context.h"
#include "httplib.h"

#include <map>
#include <mutex>

// Per-port serialisation — mlx_lm.server is single-threaded per port.
// Acquire before every HTTP call to a port; released on return.
// Lives here (inline) so route implementations can use it without a
// separate TU.
//
// Lock acquisition order (MS-147 — never invert, deadlock avoidance):
//   1. port_mutex(port)   — exclusive access to one mlx_lm.server instance
//   2. semaphore(port)    — acquired inside call_agent_impl / stream_agent
//
// Callers outside /api/mlx/* (flat.cpp, pipeline.cpp, architect stream)
// use only the semaphore, never port_mutex — no cross-order possible.
//
// registry_mu is internal to port_mutex(); callers must never hold any
// per-port mutex while calling port_mutex() for a different port.
namespace mlx_coordinator {

inline std::mutex& port_mutex(int port) {
    static std::mutex registry_mu;
    static std::map<int, std::mutex> mutexes;
    std::lock_guard<std::mutex> lk(registry_mu);
    // std::map never invalidates references on insert — reference remains
    // valid even after registry_mu is released.
    return mutexes[port];  // default-constructs on first access
}

}  // namespace mlx_coordinator

// Register all /api/mlx/* routes on svr (MS-132–140, shipped #265).
void register_coordinator_routes_mlx(httplib::Server& svr, CoordinatorState& st);

#endif  // MATRIX_MLX_NATIVE_COORD
