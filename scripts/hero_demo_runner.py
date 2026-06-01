"""
Per-scenario and per-profile runner helpers for hero_demo.py.
"""

import os
import sys

from demo_utils import (
    APP_URL, log, shot,
    select_profile, launch_and_wait_online,
    ensure_config_closed,
    set_mode, enable_rag, clear_session,
    broadcast, wait_for_response, follow_up,
    stitch_video,
)

MODES      = ["ROUTER", "FLAT", "CASCADE", "PIPELINE"]
FRAME_SECS = 2


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


def run_profile_group(browser, profile, prompts, base_dir):
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

    launch_dir = os.path.join(base_dir, f"{profile.lower()}-launch")
    os.makedirs(launch_dir, exist_ok=True)
    shot(page, launch_dir, "loaded")

    select_profile(page, profile)
    shot(page, launch_dir, "profile-selected")

    launch_and_wait_online(page, shots_dir=launch_dir)
    shot(page, launch_dir, "online")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    videos = []
    for mode in MODES:
        try:
            mov = run_mode_scenario(page, profile, mode, prompts, base_dir)
            videos.append(mov)
        except Exception as exc:
            print(f"\n❌  {profile} × {mode} failed: {exc}", file=sys.stderr)
            shot(page, os.path.join(base_dir, f"{profile.lower()}-{mode.lower()}"), "ERROR")

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
