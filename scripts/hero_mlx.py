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
    - MLX coord:    brewctl up           (port 3003 must be running)
    - Switch UI to MLX backend before or pass --backend mlx (handled below)

Note: if the MLX coordinator is not running, the script exits cleanly
      with a helpful message rather than timing out.
"""

import os

from playwright.sync_api import sync_playwright

from demo_utils import shot, select_profile, launch_and_wait_online
from hero_mlx_runner import switch_to_mlx_backend, run_scenario
from hero_mlx_checks import check_dev_server, check_mlx_coordinator, open_videos

BASE_DIR    = "/tmp/hero-mlx"
FRAME_SECS  = 2
APP_URL_MLX = "http://localhost:3000?theme=dark"

PROMPT_ROUTER = (
    "Write an async Python service that fans out requests to three "
    "downstream APIs in parallel, merges the results, and returns a "
    "unified JSON response with per-source latency"
)
PROMPT_PIPELINE = (
    "Design a Rust pipeline: parse → validate → enrich → persist. "
    "Each stage is a trait object. Show trait definitions, stage "
    "composition, and an integration test using in-memory fakes."
)


def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    check_dev_server()
    check_mlx_coordinator()

    all_videos = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            page.goto(APP_URL_MLX, wait_until="domcontentloaded", timeout=15_000)
            page.wait_for_timeout(3_000)

            launch_dir = os.path.join(BASE_DIR, "launch")
            os.makedirs(launch_dir, exist_ok=True)
            shot(page, launch_dir, "loaded")

            switch_to_mlx_backend(page)
            shot(page, launch_dir, "mlx-backend-selected")

            select_profile(page, "MAX")
            shot(page, launch_dir, "profile-selected")

            launch_and_wait_online(page, shots_dir=launch_dir)
            shot(page, launch_dir, "online")
            page.wait_for_timeout(500)

            for mode, prompt in [
                ("ROUTER",   PROMPT_ROUTER),
                ("PIPELINE", PROMPT_PIPELINE),
            ]:
                shots_dir = os.path.join(BASE_DIR, mode.lower())
                try:
                    mov = run_scenario(page, mode, prompt, shots_dir, frame_secs=FRAME_SECS)
                    all_videos.append(mov)
                except Exception as exc:
                    print(f"\n❌  {mode} scenario failed: {exc}", flush=True)
                    os.makedirs(shots_dir, exist_ok=True)
                    shot(page, shots_dir, "ERROR")

            if console_errors:
                print(f"\n⚠️  Console errors ({len(console_errors)}):")
                seen = set()
                for e in console_errors:
                    k = e[:80]
                    if k not in seen:
                        print(f"   {k}")
                        seen.add(k)

            page.close()
        finally:
            browser.close()

    open_videos(all_videos)
    print(f"\nAll screenshots: {BASE_DIR}/\n")


if __name__ == "__main__":
    main()
