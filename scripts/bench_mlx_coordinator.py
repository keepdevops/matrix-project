#!/usr/bin/env python3
"""MS-150 — Python vs C++ MLX coordinator benchmark.

Routing overhead (no agents needed) + end-to-end submit/stream when agents
are live.  Reports avg/p50/p95 per route in Markdown.  Stdlib only.

Usage:
  python3 scripts/bench_mlx_coordinator.py [--cpp URL] [--python URL]
      [--requests N] [--out PATH]
"""
from __future__ import annotations

import argparse
import json
import socket
import statistics
import sys
import time
from http.client import HTTPConnection, HTTPException
from typing import Optional
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

class Stat:
    def __init__(self, samples: list[float]) -> None:
        self.n   = len(samples)
        self.avg = statistics.mean(samples) if samples else float("nan")
        self.p50 = statistics.median(samples) if samples else float("nan")
        self.p95 = (sorted(samples)[int(0.95 * len(samples))]
                    if len(samples) >= 2 else self.avg)
        self.min = min(samples) if samples else float("nan")
        self.max = max(samples) if samples else float("nan")

    def __str__(self) -> str:
        return (f"avg {self.avg:.0f} ms  p50 {self.p50:.0f}  "
                f"p95 {self.p95:.0f}  min {self.min:.0f}  max {self.max:.0f}")


def _is_reachable(url: str) -> bool:
    parsed = urlparse(url)
    host   = parsed.hostname or "localhost"
    port   = parsed.port or 80
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _http_get(base: str, path: str) -> tuple[int, dict, float]:
    t0 = time.perf_counter()
    try:
        with urlopen(f"{base}{path}", timeout=5) as r:
            status = r.status
            body   = json.loads(r.read().decode())
    except Exception:
        return 0, {}, (time.perf_counter() - t0) * 1000
    return status, body, (time.perf_counter() - t0) * 1000


def _http_post(base: str, path: str, payload: dict) -> tuple[int, dict, float]:
    data = json.dumps(payload).encode()
    req  = Request(f"{base}{path}", data=data,
                   headers={"Content-Type": "application/json"})
    t0   = time.perf_counter()
    try:
        with urlopen(req, timeout=30) as r:
            status = r.status
            body   = json.loads(r.read().decode())
    except Exception:
        return 0, {}, (time.perf_counter() - t0) * 1000
    return status, body, (time.perf_counter() - t0) * 1000


def _stream_post(base: str, path: str, payload: dict) -> tuple[float, float, int]:
    """Returns (ttfb_ms, total_ms, token_count)."""
    parsed   = urlparse(base)
    host     = parsed.hostname or "localhost"
    port     = parsed.port or 80
    t0       = time.perf_counter()
    ttfb_ms  = float("nan")
    tokens   = 0
    try:
        conn = HTTPConnection(host, port, timeout=30)
        body = json.dumps(payload).encode()
        conn.request("POST", path, body,
                     {"Content-Type": "application/json",
                      "Accept": "text/event-stream"})
        resp = conn.getresponse()
        buf  = b""
        while True:
            chunk = resp.read(256)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode("utf-8", errors="replace").strip()
                if text.startswith("event: token") or (
                        text.startswith("data:") and '"text"' in text):
                    if tokens == 0:
                        ttfb_ms = (time.perf_counter() - t0) * 1000
                    tokens += 1
                if text == "event: done" or text.startswith("data: [DONE]"):
                    break
        conn.close()
    except (HTTPException, OSError):
        pass
    return ttfb_ms, (time.perf_counter() - t0) * 1000, tokens


def _bench(fn, n: int, *args, **kwargs) -> Stat:
    samples: list[float] = []
    for _ in range(n):
        samples.append(fn(*args, **kwargs)[-1])
    return Stat(samples)


def _agents_live(base: str) -> bool:
    status, body, _ = _http_get(base, "/api/mlx/health")
    if status != 200:
        return False
    backends = body.get("backends", {})
    return any(v.get("ok") for v in backends.values())


PROMPT = "What is 2 + 2? Reply in one sentence."


def bench_one(label: str, base: str, n: int) -> dict:
    live = _agents_live(base)
    print(f"\n  [{label}] agents {'live ✓' if live else 'offline — routing-only benchmark'}")

    results: dict[str, Stat | str] = {}

    # Routing-only routes (no agent backend needed)
    for path, name in [
        ("/api/mlx/health",   "GET /health"),
        ("/api/mlx/pressure", "GET /pressure"),
        ("/api/mlx/agents",   "GET /agents"),
        ("/api/mlx/modes",    "GET /modes"),
    ]:
        s = _bench(_http_get, n, base, path)
        results[name] = s
        print(f"    {name:22s}  {s}")

    if not live:
        results["__agents_live"] = False
        return results

    # End-to-end routes (require live MLX agents)
    payload = {"prompt": PROMPT}

    # POST /api/mlx/submit — blocking
    s_submit = _bench(_http_post, n, base, "/api/mlx/submit", payload)
    results["POST /submit"] = s_submit
    print(f"    {'POST /submit':22s}  {s_submit}")

    # POST /api/mlx/stream — SSE (TTFB + total)
    ttfbs, totals, tok_counts = [], [], []
    for _ in range(n):
        ttfb, total, tokens = _stream_post(base, "/api/mlx/stream", payload)
        if not (ttfb != ttfb):  # not NaN
            ttfbs.append(ttfb)
        totals.append(total)
        tok_counts.append(tokens)

    if ttfbs:
        results["STREAM TTFB"]  = Stat(ttfbs)
        results["STREAM total"] = Stat(totals)
        avg_toks = statistics.mean(tok_counts) if tok_counts else 0
        avg_secs = Stat(totals).avg / 1000
        results["__tok_s"] = f"{avg_toks / avg_secs:.1f}" if avg_secs > 0 else "n/a"
        print(f"    {'STREAM TTFB':22s}  {results['STREAM TTFB']}")
        print(f"    {'STREAM total':22s}  {results['STREAM total']}")
        print(f"    approx tok/s: {results['__tok_s']}")

    results["__agents_live"] = True
    return results


def _stat_md(s: Stat | str | bool | None) -> str:
    if not isinstance(s, Stat):
        return "—"
    return f"avg **{s.avg:.0f}** / p50 {s.p50:.0f} / p95 {s.p95:.0f} ms"


def format_report(cpp: dict, py: dict, n: int, cpp_url: str, py_url: str) -> str:
    lines = [
        "# MS-150 — MLX Coordinator Benchmark: Python vs C++",
        "",
        f"- **C++ coordinator:** `{cpp_url}`",
        f"- **Python coordinator:** `{py_url}`",
        f"- **Requests per route:** {n}",
        f"- **Prompt:** `{PROMPT}`",
        "",
        "## Results",
        "",
        "| Route | C++ (avg / p50 / p95) | Python (avg / p50 / p95) | Δ avg |",
        "|-------|-----------------------|--------------------------|-------|",
    ]
    all_keys = [k for k in cpp if not k.startswith("__")]
    for key in all_keys:
        cpp_s = cpp.get(key)
        py_s  = py.get(key)
        delta = "—"
        if isinstance(cpp_s, Stat) and isinstance(py_s, Stat):
            diff = py_s.avg - cpp_s.avg
            sign = "+" if diff > 0 else ""
            delta = f"{sign}{diff:.0f} ms"
        lines.append(f"| `{key}` | {_stat_md(cpp_s)} | {_stat_md(py_s)} | {delta} |")

    if cpp.get("__tok_s") or py.get("__tok_s"):
        lines += [
            "",
            "### Streaming throughput (tok/s, approx)",
            "",
            f"- C++: {cpp.get('__tok_s', '—')}",
            f"- Python: {py.get('__tok_s', '—')}",
        ]

    if not cpp.get("__agents_live") or not py.get("__agents_live"):
        lines += [
            "",
            "> **Note:** one or both coordinators had no live MLX agents.",
            "> End-to-end submit/stream results are absent for the offline side.",
            "> Re-run with `brewctl up` and at least one MLX agent configured.",
        ]
    return "\n".join(lines)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cpp",      default="http://localhost:3002",
                   metavar="URL", help="C++ coordinator base URL")
    p.add_argument("--python",   default="http://localhost:3003",
                   metavar="URL", help="Python coordinator base URL")
    p.add_argument("--requests", default=5, type=int, metavar="N",
                   help="requests per route (default 5)")
    p.add_argument("--out",      metavar="PATH",
                   help="write Markdown report to file instead of stdout")
    args = p.parse_args()

    cpp_ok = _is_reachable(args.cpp)
    py_ok  = _is_reachable(args.python)

    if not cpp_ok and not py_ok:
        print("❌ Neither coordinator is reachable. Start at least one and retry.",
              file=sys.stderr)
        sys.exit(1)

    print(f"MS-150 benchmark  n={args.requests}")
    print(f"  C++ coordinator  {args.cpp}  {'✓ reachable' if cpp_ok else '✗ offline'}")
    print(f"  Py  coordinator  {args.python}  {'✓ reachable' if py_ok else '✗ offline'}")

    cpp_results: dict = {}
    py_results:  dict = {}

    if cpp_ok:
        print("\n── C++ coordinator ──")
        cpp_results = bench_one("C++", args.cpp, args.requests)
    if py_ok:
        print("\n── Python coordinator ──")
        py_results = bench_one("Python", args.python, args.requests)

    report = format_report(cpp_results, py_results,
                           args.requests, args.cpp, args.python)

    if args.out:
        with open(args.out, "w") as fh:
            fh.write(report + "\n")
        print(f"\nReport written to {args.out}")
    else:
        print("\n" + report)


if __name__ == "__main__":
    main()
