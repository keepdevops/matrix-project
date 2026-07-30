"""Browser session body for hero_mlx.py — page interactions and scenario loop."""

import os

from demo_utils import shot, select_profile, launch_and_wait_online
from hero_mlx_runner import switch_to_mlx_backend, run_scenario

APP_URL_MLX = "http://localhost:3000?theme=dark"


def run_session(page, base_dir, frame_secs, scenarios):
    """Drive the browser page through all scenarios; return list of video paths."""
    launch_dir = os.path.join(base_dir, "launch")
    os.makedirs(launch_dir, exist_ok=True)

    page.goto(APP_URL_MLX, wait_until="domcontentloaded", timeout=15_000)
    page.wait_for_timeout(3_000)
    shot(page, launch_dir, "loaded")

    switch_to_mlx_backend(page)
    shot(page, launch_dir, "mlx-backend-selected")

    select_profile(page, "MAX")
    shot(page, launch_dir, "profile-selected")

    launch_and_wait_online(page, shots_dir=launch_dir)
    shot(page, launch_dir, "online")
    page.wait_for_timeout(500)

    all_videos = []
    for mode, prompt in scenarios:
        shots_dir = os.path.join(base_dir, mode.lower())
        try:
            mov = run_scenario(page, mode, prompt, shots_dir, frame_secs=frame_secs)
            all_videos.append(mov)
        except Exception as exc:
            print(f"\n❌  {mode} scenario failed: {exc}", flush=True)
            os.makedirs(shots_dir, exist_ok=True)
            shot(page, shots_dir, "ERROR")

    return all_videos


def report_console_errors(console_errors):
    if not console_errors:
        return
    print(f"\n⚠️  Console errors ({len(console_errors)}):")
    seen = set()
    for e in console_errors:
        k = e[:80]
        if k not in seen:
            print(f"   {k}")
            seen.add(k)
