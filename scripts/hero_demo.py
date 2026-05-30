#!/usr/bin/env python3
"""
Swarm Matrix hero demo — 16 videos covering all 4 profiles × all 4 modes.

Each profile is launched once; all 4 modes are exercised back-to-back
(mode switch, no re-launch) to minimise total runtime.

RAG is enabled for every broadcast.
Frame duration: 2 seconds per screenshot.

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/hero_demo.py

Prerequisites:
    - Dev server:  npm start  (http://localhost:3000)
    - Proxy:       brewctl up  (or npm run proxy)
"""

import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

from demo_utils import (
    APP_URL, log, shot,
    select_profile, launch_and_wait_online,
    ensure_config_closed,
    set_mode, enable_rag, clear_session,
    broadcast, wait_for_response, follow_up,
    stitch_video,
)

BASE_DIR = "/tmp/hero-demo"
MODES    = ["ROUTER", "FLAT", "CASCADE", "PIPELINE"]
FRAME_SECS = 2

# ---------------------------------------------------------------------------
# Prompts — one language per profile, same set across all 4 modes
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# Per-scenario runner
# ---------------------------------------------------------------------------

def run_mode_scenario(page, profile, mode, prompts, base_dir):
    """
    Run one (profile, mode) scenario on an already-online swarm page.
    Produces screenshots in base_dir/{profile}-{mode}/ and stitches a .mov.
    """
    scenario_key = f"{profile.lower()}-{mode.lower()}"
    shots_dir    = os.path.join(base_dir, scenario_key)
    output_mov   = os.path.join(base_dir, f"{scenario_key}.mov")
    os.makedirs(shots_dir, exist_ok=True)

    log(f"=== {profile} × {mode} ({prompts['lang']}) ===")

    # Mode switch + RAG + fresh session
    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    enable_rag(page)
    clear_session(page)

    # Prompt 1
    broadcast(page, prompts["p1"], 1)
    wait_for_response(page, shots_dir, "p1-response")

    # Prompt 2
    broadcast(page, prompts["p2"], 2)
    wait_for_response(page, shots_dir, "p2-response")

    # Follow-up
    follow_up(page, prompts["f1"], shots_dir, "followup-response")

    # Final full-page screenshot
    page.wait_for_timeout(600)
    shot(page, shots_dir, "final")

    # Stitch video
    stitch_video(shots_dir, output_mov, frame_secs=FRAME_SECS)
    return output_mov


# ---------------------------------------------------------------------------
# Per-profile group runner
# ---------------------------------------------------------------------------

def run_profile_group(browser, profile, base_dir):
    """
    Open a fresh page, launch the swarm with `profile`, then run all 4 modes.
    Returns list of produced .mov paths.
    """
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    console_errors = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    log(f"{'=' * 60}\nPROFILE GROUP: {profile}\n{'=' * 60}")

    page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
    page.wait_for_timeout(3_000)

    # One screenshot directory for the launch step
    launch_dir = os.path.join(base_dir, f"{profile.lower()}-launch")
    os.makedirs(launch_dir, exist_ok=True)
    shot(page, launch_dir, "loaded")

    select_profile(page, profile)
    shot(page, launch_dir, "profile-selected")

    launch_and_wait_online(page, shots_dir=launch_dir)
    shot(page, launch_dir, "online")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    prompts = PROMPTS[profile]
    videos  = []

    for mode in MODES:
        try:
            mov = run_mode_scenario(page, profile, mode, prompts, base_dir)
            videos.append(mov)
        except Exception as exc:
            print(f"\n❌  {profile} × {mode} failed: {exc}", file=sys.stderr)
            shot(page, os.path.join(base_dir, f"{profile.lower()}-{mode.lower()}"),
                 "ERROR")

    if console_errors:
        print(f"\n⚠️  Console errors during {profile} group ({len(console_errors)}):")
        seen = set()
        for e in console_errors:
            key = e[:80]
            if key not in seen:
                print(f"   {key}")
                seen.add(key)

    page.close()
    return videos


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    # Verify dev server is reachable before starting
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
                videos = run_profile_group(browser, profile, BASE_DIR)
                all_videos.extend(videos)
        finally:
            browser.close()

    # Summary
    log("=== HERO DEMO COMPLETE ===")
    print(f"\nProduced {len(all_videos)} video(s):\n")
    for v in all_videos:
        size = os.path.getsize(v) / (1024 * 1024) if os.path.exists(v) else 0
        print(f"  🎬  {v}  ({size:.1f} MB)")

    # Open all in QuickTime
    if all_videos:
        subprocess.run(["open"] + [v for v in all_videos if os.path.exists(v)])

    print(f"\nAll screenshots: {BASE_DIR}/\n")


if __name__ == "__main__":
    main()
