#!/usr/bin/env python3
"""Re-run the 3 failed MIXED scenarios: flat, cascade, pipeline."""

import os, subprocess, sys
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
MODES = ["FLAT", "CASCADE", "PIPELINE"]
FRAME_SECS = 2

PROMPTS = {
    "lang": "TypeScript",
    "p1":  "Write an Express TypeScript REST API for a todo list with full CRUD endpoints",
    "p2":  "Add JWT auth, input validation with zod, and rate limiting middleware",
    "f1":  "Write Jest integration tests using supertest covering all endpoints",
}

def run_mode_scenario(page, mode, prompts, base_dir):
    scenario_key = f"mixed-{mode.lower()}"
    shots_dir    = os.path.join(base_dir, scenario_key)
    output_mov   = os.path.join(base_dir, f"{scenario_key}.mov")
    os.makedirs(shots_dir, exist_ok=True)
    # Clean up stale screenshots from failed run
    for f in os.listdir(shots_dir):
        if f.endswith(".png"):
            os.remove(os.path.join(shots_dir, f))
    frames_dir = shots_dir + "_frames"
    if os.path.isdir(frames_dir):
        for f in os.listdir(frames_dir):
            os.remove(os.path.join(frames_dir, f))

    log(f"=== MIXED × {mode} (TypeScript) ===")
    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    enable_rag(page)
    clear_session(page)

    broadcast(page, prompts["p1"], 1)
    wait_for_response(page, shots_dir, "p1-response")

    broadcast(page, prompts["p2"], 2)
    wait_for_response(page, shots_dir, "p2-response")

    follow_up(page, prompts["f1"], shots_dir, "followup-response")
    page.wait_for_timeout(600)
    shot(page, shots_dir, "final")

    stitch_video(shots_dir, output_mov, frame_secs=FRAME_SECS)
    return output_mov

def main():
    import urllib.request
    try:
        urllib.request.urlopen("http://localhost:3000", timeout=5)
    except Exception:
        print("❌  Dev server not reachable at http://localhost:3000", file=sys.stderr)
        sys.exit(1)

    videos = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
            page.wait_for_timeout(3_000)

            launch_dir = os.path.join(BASE_DIR, "mixed-launch-retry")
            os.makedirs(launch_dir, exist_ok=True)
            shot(page, launch_dir, "loaded")

            select_profile(page, "MIXED")
            launch_and_wait_online(page, shots_dir=launch_dir)
            ensure_config_closed(page)
            page.wait_for_timeout(500)

            for mode in MODES:
                try:
                    mov = run_mode_scenario(page, mode, PROMPTS, BASE_DIR)
                    videos.append(mov)
                except Exception as exc:
                    print(f"\n❌  MIXED × {mode} failed: {exc}", file=sys.stderr)
                    shot(page, os.path.join(BASE_DIR, f"mixed-{mode.lower()}"), "ERROR")
            page.close()
        finally:
            browser.close()

    print(f"\nProduced {len(videos)} video(s):\n")
    for v in videos:
        size = os.path.getsize(v) / (1024 * 1024) if os.path.exists(v) else 0
        print(f"  🎬  {v}  ({size:.1f} MB)")

    if videos:
        subprocess.run(["open"] + [v for v in videos if os.path.exists(v)])

if __name__ == "__main__":
    main()
