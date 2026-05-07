#pragma once

// Per-port telemetry for MLX agents. mlx-lm has no /metrics or /slots, so we
// measure pressure at the coordinator:
//   * inflight: request count (queued + active), incremented on entry to
//     call_agent_impl and decremented on exit. Used for queue_depth.
//   * completion stats: EMA of wall-time and decode rate per request, fed by
//     call_agent_impl on success. Used to derive expected_wait_secs and
//     decode_rate_tps for the cluster-of-gauges UI.

namespace mlx_inflight {

// Inflight counter ----------------------------------------------------------
void inc(int port);
void dec(int port);
int  get(int port);

// RAII guard for inc/dec around a single request lifetime.
struct Scope {
    int port;
    explicit Scope(int p) : port(p) { inc(port); }
    ~Scope() { dec(port); }
    Scope(const Scope&) = delete;
    Scope& operator=(const Scope&) = delete;
};

// Completion telemetry ------------------------------------------------------
// Record one successful request: secs = wall time spent in /v1/chat/completions,
// completion_tokens = tokens generated (from the response usage block).
// Both EMAs use alpha=0.3 and seed from the first sample. Caller MUST pass
// secs > 0 and tokens >= 0; otherwise the sample is dropped (fail loudly via
// stderr) so a bad measurement can't poison the gauge.
void record_completion(int port, double secs, long completion_tokens);

// Returns -1.0 if no samples yet — pressure.cpp surfaces this as null.
double avg_decode_secs(int port);
double avg_decode_tps(int port);

}  // namespace mlx_inflight
