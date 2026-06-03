#!/usr/bin/env python3
"""
Brewlatte 2.1.0 hero video — MLX backend showcase.

Demonstrates the MLX inference path with the fixes from 2.1.0:
session continuity, pipeline stage outputs, router metadata, and
live per-agent streaming on the Live tab.

Scenario (MLX-SCOUT profile, two modes):
  1. ROUTER mode  → broadcast → show Live tab + timings + expand popout
  2. PIPELINE mode → broadcast → show stage outputs + expand popout

Output: /tmp/hero-mlx/{scenario}.mov  (ProRes, 2 s/frame)

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/hero_mlx.py

Prerequisites:
    - Dev server:   npm start            (http://localhost:3000)
    - Proxy/coord:  brewctl launch       (C++ coordinator on :3002)

Note: if the C++ coordinator is not reachable, the script exits cleanly
      with a helpful message rather than timing out.
"""

import os

from playwright.sync_api import sync_playwright

from hero_mlx_checks import check_dev_server, check_mlx_coordinator, open_videos
from hero_mlx_session import run_session, report_console_errors

BASE_DIR   = "/tmp/hero-mlx"
FRAME_SECS = 2

SCENARIOS = [
    ("ROUTER", (
        "Write an async Python service that fans out requests to three "
        "downstream APIs in parallel, merges the results, and returns a "
        "unified JSON response with per-source latency"
    )),
    ("PIPELINE", (
        "Design a Rust pipeline: parse → validate → enrich → persist. "
        "Each stage is a trait object. Show trait definitions, stage "
        "composition, and an integration test using in-memory fakes."
    )),
]


def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    check_dev_server()
    check_mlx_coordinator()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            all_videos = run_session(page, BASE_DIR, FRAME_SECS, SCENARIOS)
            report_console_errors(console_errors)
            page.close()
        finally:
            browser.close()

    open_videos(all_videos)
    print(f"\nAll screenshots: {BASE_DIR}/\n")


if __name__ == "__main__":
    main()
