#!/usr/bin/env python3
"""
Swarm Matrix hero demo — 16 videos covering all 4 profiles × all 4 modes.

Each profile is launched once; all 4 modes are exercised back-to-back
(mode switch, no re-launch) to minimise total runtime.

RAG is enabled for every broadcast.
Frame duration: 2 seconds per screenshot.

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/demo/hero_demo.py

Prerequisites:
    - Dev server:  npm start  (http://localhost:3000)
    - Proxy:       brewctl up  (or npm run proxy)
"""

import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

from hero_demo_runner import run_profile_group

BASE_DIR = "/tmp/hero-demo"

PROMPTS = {
    "SAFE": {
        "lang": "Go",
        "p1":  "Write a Go HTTP server with /health and /ready endpoints returning JSON status",
        "p2":  "Add structured request logging middleware using the slog package",
        "f1":  "Refactor to use graceful shutdown with os.Signal and context cancellation",
    },
    "BALANCED": {
        "lang": "Python",
        "p1":  "Write a FastAPI service with /health, /version, and a POST /process endpoint",
        "p2":  "Add JWT bearer token auth middleware and a /token endpoint",
        "f1":  "Write pytest tests with httpx.AsyncClient covering auth and all endpoints",
    },
    "MAX": {
        "lang": "Rust",
        "p1":  "Write a Rust Tokio TCP echo server with graceful shutdown on Ctrl-C",
        "p2":  "Add connection limiting with a semaphore and per-connection read timeouts",
        "f1":  "Write integration tests using tokio::net::TcpStream and tokio::test",
    },
    "MIXED": {
        "lang": "TypeScript",
        "p1":  "Write an Express TypeScript REST API for a todo list with full CRUD endpoints",
        "p2":  "Add JWT auth, input validation with zod, and rate limiting middleware",
        "f1":  "Write Jest integration tests using supertest covering all endpoints",
    },
}


def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    import urllib.request
    try:
        urllib.request.urlopen("http://localhost:3000", timeout=5)
    except Exception:
        print("❌  Dev server not reachable at http://localhost:3000", file=sys.stderr)
        print("    Run: npm start", file=sys.stderr)
        sys.exit(1)

    all_videos = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for profile in ["SAFE", "BALANCED", "MAX", "MIXED"]:
                videos = run_profile_group(browser, profile, PROMPTS[profile], BASE_DIR)
                all_videos.extend(videos)
        finally:
            browser.close()

    print(f"\nProduced {len(all_videos)} video(s):\n")
    for v in all_videos:
        size = os.path.getsize(v) / (1024 * 1024) if os.path.exists(v) else 0
        print(f"  🎬  {v}  ({size:.1f} MB)")

    if all_videos:
        subprocess.run(["open"] + [v for v in all_videos if os.path.exists(v)])

    print(f"\nAll screenshots: {BASE_DIR}/\n")


if __name__ == "__main__":
    main()
