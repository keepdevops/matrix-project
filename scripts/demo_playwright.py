#!/usr/bin/env python3
"""
Swarm Matrix demo — Playwright-driven end-to-end walkthrough.

Rounds:
  A  BALANCED profile → ROUTER mode  → 2 prompts + 1 follow-up
  B  (swarm stays online) → FLAT mode → 1 prompt
  C  SAFE profile re-launch → CASCADE mode → 1 prompt + 1 follow-up

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/demo_playwright.py

Requirements:
  - Dev server running on http://localhost:3000  (npm start)
  - Coordinator proxy running                    (brewctl up  or  npm run proxy)
"""

import os
import sys
from playwright.sync_api import sync_playwright

from demo_playwright_actions import (
    log, shot,
    ensure_config_closed,
    select_profile, launch_and_wait_online,
    set_mode, broadcast, wait_for_response, follow_up,
)

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


def _shot(page, label):
    return shot(page, SHOTS_DIR, shot_idx, label)

def _wait(page, label):
    return wait_for_response(page, SHOTS_DIR, shot_idx, label)

def _follow_up(page, text, label):
    return follow_up(page, text, SHOTS_DIR, shot_idx, label)

def _launch(page):
    return launch_and_wait_online(page, SHOTS_DIR, shot_idx)


def run_demo(page):
    log("Loading Swarm Matrix…")
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
    page.wait_for_timeout(3_000)
    _shot(page, "00-initial-load")

    # ── Round A: BALANCED profile, ROUTER mode ───────────────────────────────
    log("=== ROUND A: BALANCED → ROUTER ===")

    select_profile(page, "BALANCED")
    _shot(page, "01-balanced-selected")

    _launch(page)
    _shot(page, "02-online-after-balanced-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    set_mode(page, "ROUTER")
    _shot(page, "03-router-mode-set")

    broadcast(page, PROMPTS[1], 1)
    _wait(page, "04-router-prompt1-response")
    _follow_up(page, PROMPTS[2], "05-router-followup-response")

    # ── Round B: FLAT mode, no re-launch ─────────────────────────────────────
    log("=== ROUND B: FLAT mode (swarm stays online) ===")

    set_mode(page, "FLAT")
    _shot(page, "06-flat-mode-set")

    broadcast(page, PROMPTS[3], 3)
    _wait(page, "07-flat-prompt3-response")

    # ── Round C: SAFE profile re-launch, CASCADE mode ────────────────────────
    log("=== ROUND C: SAFE profile re-launch → CASCADE ===")

    select_profile(page, "SAFE")
    _shot(page, "08-safe-selected")

    _launch(page)
    _shot(page, "09-online-after-safe-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    set_mode(page, "CASCADE")
    _shot(page, "10-cascade-mode-set")

    broadcast(page, PROMPTS[4], 4)
    _wait(page, "11-cascade-prompt4-response")
    _follow_up(page, PROMPTS[5], "12-cascade-followup-final")

    log("=== DEMO COMPLETE ===")
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
