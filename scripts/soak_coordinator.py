#!/usr/bin/env python3
"""MS-161 Phase D — coordinator soak test.

Drives /api/architect against a running coordinator for a fixed duration,
sampling the coordinator's RSS to detect leaks. Sequential modes
(pipeline/cascade) exercise the backend-routing path when
MATRIX_BACKEND_ROUTING=1 was set at coordinator launch.

Usage:
  python3 scripts/soak_coordinator.py --url http://localhost:8000 \
      --duration 3600 --mode pipeline

Exit 0 = soak clean (no failures, RSS stable); 1 = failures or RSS growth.
Stdlib + psutil only.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from urllib import request as urlreq, error as urlerr
from urllib.parse import urlparse

try:
    import psutil
except ImportError:
    psutil = None

# RSS is considered "leaking" if final exceeds the early-baseline by more than
# this fraction (allows for steady-state cache warmup; flags monotonic growth).
RSS_LEAK_FRACTION = 0.15


def _coord_pid(url: str):
    if psutil is None:
        return None
    port = urlparse(url).port or 80
    try:
        for c in psutil.net_connections(kind="tcp"):
            if c.laddr.port == port and c.status == "LISTEN" and c.pid:
                return c.pid
    except Exception:
        pass
    return None


def _rss_mb(pid) -> float:
    if pid is None or psutil is None:
        return float("nan")
    try:
        return psutil.Process(pid).memory_info().rss / (1024 * 1024)
    except Exception:
        return float("nan")


def _post(url: str, path: str, body: dict, timeout: float = 60.0):
    data = json.dumps(body).encode()
    req = urlreq.Request(url + path, data=data,
                         headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urlreq.urlopen(req, timeout=timeout) as r:
            r.read()
            return True, (time.perf_counter() - t0) * 1000
    except (urlerr.HTTPError, urlerr.URLError, OSError):
        return False, (time.perf_counter() - t0) * 1000


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url",      default="http://localhost:8000")
    p.add_argument("--duration", type=int, default=120, help="seconds (default 120)")
    p.add_argument("--mode",     default="pipeline",
                   help="pipeline | cascade | flat (set via /api/modes/active)")
    p.add_argument("--prompt",   default="Write a short function and explain it.")
    p.add_argument("--rss-every", type=int, default=10, help="RSS sample interval (s)")
    args = p.parse_args()

    # Switch the coordinator into the requested mode.
    ok, _ = _post(args.url, "/api/modes/active", {"mode": args.mode}, timeout=5)
    if not ok:
        print(f"⚠️  could not set mode {args.mode} (continuing on current mode)")

    pid = _coord_pid(args.url)
    if pid is None:
        print("⚠️  coordinator PID not found (psutil missing or port mismatch) — "
              "RSS leak check disabled; request stability still measured.")

    print(f"MS-161 Phase D soak — url={args.url} mode={args.mode} "
          f"duration={args.duration}s pid={pid}")

    rss_samples: list[tuple[float, float]] = []
    lat: list[float] = []
    n_ok = n_fail = 0
    start = time.time()
    next_rss = start

    while time.time() - start < args.duration:
        ok, ms = _post(args.url, "/api/architect", {"prompt": args.prompt})
        lat.append(ms)
        if ok:
            n_ok += 1
        else:
            n_fail += 1
        now = time.time()
        if now >= next_rss:
            rss = _rss_mb(pid)
            rss_samples.append((now - start, rss))
            if rss == rss:  # not NaN
                print(f"  t={now-start:6.0f}s  reqs={n_ok+n_fail:5d}  "
                      f"fail={n_fail}  rss={rss:7.1f} MB")
            next_rss = now + args.rss_every

    # ── Report ────────────────────────────────────────────────────────────────
    total = n_ok + n_fail
    avg_ms = sum(lat) / len(lat) if lat else float("nan")
    print("\n── Soak result ─────────────────────────────────────")
    print(f"  requests : {total}  (ok {n_ok}, fail {n_fail})")
    print(f"  avg latency : {avg_ms:.0f} ms")

    leak = False
    if len([s for _, s in rss_samples if s == s]) >= 2:
        valid = [s for _, s in rss_samples if s == s]
        baseline = valid[min(1, len(valid) - 1)]   # 2nd sample (post-warmup)
        peak = max(valid)
        final = valid[-1]
        growth = (final - baseline) / baseline if baseline > 0 else 0.0
        print(f"  RSS baseline/peak/final : {baseline:.1f} / {peak:.1f} / {final:.1f} MB")
        print(f"  RSS growth vs baseline  : {growth*100:+.1f}% "
              f"(leak threshold {RSS_LEAK_FRACTION*100:.0f}%)")
        leak = growth > RSS_LEAK_FRACTION
    else:
        print("  RSS : not sampled (no leak verdict)")

    if n_fail > 0:
        print(f"\n❌ SOAK FAIL — {n_fail} request failure(s)")
        sys.exit(1)
    if leak:
        print("\n❌ SOAK FAIL — RSS grew beyond leak threshold")
        sys.exit(1)
    print("\n✅ SOAK CLEAN — no failures, RSS stable")


if __name__ == "__main__":
    main()
