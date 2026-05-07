#include "mlx_inflight.h"

#include <atomic>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>

namespace mlx_inflight {

namespace {

constexpr double EMA_ALPHA = 0.3;

struct PortStats {
    std::atomic<int> inflight{0};
    // Guarded by stats_mu — atomics not enough for paired writes.
    double ema_secs = -1.0;
    double ema_tps  = -1.0;
};

std::mutex g_mu;
std::map<int, std::unique_ptr<PortStats>> g_ports;
// Coarse mutex for EMA writes/reads. Held briefly; never blocks the request path.
std::mutex stats_mu;

PortStats& slot_for(int port) {
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_ports.find(port);
    if (it == g_ports.end()) {
        it = g_ports.emplace(port, std::make_unique<PortStats>()).first;
    }
    return *it->second;
}

double ema_step(double prev, double sample) {
    if (prev < 0.0) return sample;  // seed from first sample
    return EMA_ALPHA * sample + (1.0 - EMA_ALPHA) * prev;
}

}  // namespace

void inc(int port) { slot_for(port).inflight.fetch_add(1, std::memory_order_relaxed); }
void dec(int port) { slot_for(port).inflight.fetch_sub(1, std::memory_order_relaxed); }

int get(int port) {
    std::lock_guard<std::mutex> lk(g_mu);
    auto it = g_ports.find(port);
    if (it == g_ports.end()) return 0;
    int v = it->second->inflight.load(std::memory_order_relaxed);
    return v < 0 ? 0 : v;
}

void record_completion(int port, double secs, long completion_tokens) {
    if (secs <= 0.0 || completion_tokens < 0) {
        std::cerr << "⚠️  [mlx_inflight] dropped sample port=" << port
                  << " secs=" << secs << " tokens=" << completion_tokens << std::endl;
        return;
    }
    PortStats& s = slot_for(port);
    double tps = (completion_tokens > 0) ? (static_cast<double>(completion_tokens) / secs) : -1.0;
    std::lock_guard<std::mutex> lk(stats_mu);
    s.ema_secs = ema_step(s.ema_secs, secs);
    if (tps > 0.0) s.ema_tps = ema_step(s.ema_tps, tps);
}

double avg_decode_secs(int port) {
    PortStats& s = slot_for(port);
    std::lock_guard<std::mutex> lk(stats_mu);
    return s.ema_secs;
}

double avg_decode_tps(int port) {
    PortStats& s = slot_for(port);
    std::lock_guard<std::mutex> lk(stats_mu);
    return s.ema_tps;
}

}  // namespace mlx_inflight
