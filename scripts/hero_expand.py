#!/usr/bin/env python3
"""
Brewlatte 2.1.0 hero video — right-panel agent expand / brewcast popout.

Demonstrates the ⤢ expand button on runtime agent cards in the Agents tab
(right panel) after a brewcast run, showing the full response and code block.

Scenarios (one launch, two modes):
  1. ROUTER mode → broadcast → Agents tab → expand 3 runtime cards
  2. Re-deploy   → FLAT mode  → broadcast → Agents tab → expand 3 runtime cards

Output: /tmp/hero-expand/{router,flat}.mov  (ProRes, 2 s/frame)

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/hero_expand.py

Prerequisites:
    - Dev server:  npm start          (http://localhost:3000)
    - Coordinator: brewctl up
"""

import os
import sys

from playwright.sync_api import sync_playwright

from demo_utils import (
    APP_URL, shot,
    select_profile, launch_and_wait_online,
    wait_for_agents_ready,
)
from hero_expand_actions import run_scenario

BASE_DIR = "/tmp/hero-expand"

PROMPT_ROUTER = (
    "Write a Python async HTTP client that retries on 429/503 with "
    "exponential backoff and jitter, returning structured error objects"
)
PROMPT_FLAT = (
    "Write a Rust function that parses a TOML config file, validates "
    "required fields, and returns a typed Config struct with clear error messages"
)


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
        browser = p.chromium.launch(
            executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            headless=True,
        )
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

            page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
            page.wait_for_timeout(3_000)

            launch_dir = os.path.join(BASE_DIR, "launch")
            os.makedirs(launch_dir, exist_ok=True)
            shot(page, launch_dir, "loaded")

            select_profile(page, "BALANCED")
            shot(page, launch_dir, "profile-selected")

            launch_and_wait_online(page, shots_dir=launch_dir)
            shot(page, launch_dir, "online")

            for i, (mode, prompt) in enumerate([
                ("ROUTER", PROMPT_ROUTER),
                ("FLAT",   PROMPT_FLAT),
            ]):
                if i > 0:
                    launch_and_wait_online(page, shots_dir=launch_dir)
                    wait_for_agents_ready(page, shots_dir=launch_dir)

                shots_dir = os.path.join(BASE_DIR, mode.lower())
                try:
                    mov = run_scenario(page, mode, prompt, shots_dir)
                    all_videos.append(mov)
                except Exception as exc:
                    print(f"\n❌  {mode} scenario failed: {exc}", file=sys.stderr)
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

    print(f"\nProduced {len(all_videos)} video(s):\n")
    for v in all_videos:
        size = os.path.getsize(v) / (1024 * 1024) if os.path.exists(v) else 0
        print(f"  🎬  {v}  ({size:.1f} MB)")

    import subprocess
    if all_videos:
        subprocess.run(["open"] + [v for v in all_videos if os.path.exists(v)])

    print(f"\nAll screenshots: {BASE_DIR}/\n")


if __name__ == "__main__":
    main()
