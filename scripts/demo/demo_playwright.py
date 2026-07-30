#!/usr/bin/env python3
"""
Swarm Matrix demo — Playwright-driven end-to-end walkthrough.

Rounds:
  A  BALANCED profile → ROUTER mode  → 2 prompts + 1 follow-up
  B  (swarm stays online) → FLAT mode → 1 prompt
  C  SAFE profile re-launch → CASCADE mode → 1 prompt + 1 follow-up

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/demo/demo_playwright.py

Requirements:
  - Dev server running on http://localhost:3000  (npm start)
  - Coordinator proxy running                    (brewctl up  or  npm run proxy)
"""

import os
import sys
from playwright.sync_api import sync_playwright

from demo_playwright_actions import log, shot, wait_for_response, follow_up
from demo_playwright_rounds import run_round_a, run_round_b, run_round_c

APP_URL   = "http://localhost:3000?theme=dark"
SHOTS_DIR = "/tmp/matrix-demo"

PROMPTS = {
    1: "Write a Go HTTP server with a /health endpoint that returns JSON",
    2: "Add middleware to log every request with method, path, and latency",
    3: "Refactor the server to use graceful shutdown on SIGTERM",
    4: "Add a /metrics endpoint that returns uptime and total requests served",
    5: "Write tests for the /health and /metrics endpoints using httptest",
}

os.makedirs(SHOTS_DIR, exist_ok=True)
shot_idx = [0]


def _shot(page, label):   return shot(page, SHOTS_DIR, shot_idx, label)
def _wait(page, label):   return wait_for_response(page, SHOTS_DIR, shot_idx, label)
def _follow(page, t, l):  return follow_up(page, t, SHOTS_DIR, shot_idx, l)


def run_demo(page):
    from demo_utils import log as dlog
    dlog("Loading Swarm Matrix…")
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
    page.wait_for_timeout(3_000)
    _shot(page, "00-initial-load")

    run_round_a(page, SHOTS_DIR, shot_idx, PROMPTS, _shot, _wait, _follow)
    run_round_b(page, SHOTS_DIR, shot_idx, PROMPTS, _shot, _wait)
    run_round_c(page, SHOTS_DIR, shot_idx, PROMPTS, _shot, _wait, _follow)

    dlog("=== DEMO COMPLETE ===")
    print(f"\nAll screenshots saved to: {SHOTS_DIR}/\n")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        console_errors = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        try:
            run_demo(page)
        except Exception as exc:
            shot(page, SHOTS_DIR, shot_idx, "ERROR-state")
            print(f"\n❌  Demo failed: {exc}", file=sys.stderr)
            sys.exit(1)
        finally:
            if console_errors:
                print("\n⚠️  Console errors during demo:")
                for e in console_errors[:10]:
                    print(f"   {e}")
            browser.close()


if __name__ == "__main__":
    main()
