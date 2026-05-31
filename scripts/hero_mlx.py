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
import sys
import time

from playwright.sync_api import sync_playwright

from demo_utils import (
    log, shot,
    set_mode, clear_session,
    broadcast, wait_for_response,
    switch_right_tab, stitch_video,
)

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


# ---------------------------------------------------------------------------
# MLX-specific helpers
# ---------------------------------------------------------------------------

def switch_to_mlx_backend(page):
    """Click the MLX backend toggle if available."""
    btn = page.query_selector(".brew-backend-mlx, [data-backend='mlx'], button.mlx-btn")
    if btn:
        btn.click()
        page.wait_for_timeout(400)
        print("  ✓  Switched to MLX backend")
    else:
        # Try the engine pill
        pills = page.query_selector_all(".brew-engine-pill, .brew-engine-btn")
        for pill in pills:
            if "MLX" in pill.inner_text().upper():
                pill.click()
                page.wait_for_timeout(400)
                print("  ✓  MLX engine selected")
                return
        print("  ⚠  MLX backend toggle not found — continuing on current backend")


def wait_for_live_tab_agents(page, shots_dir, label, timeout_ms=60_000):
    """Switch to the Live tab and wait for agent cards to populate."""
    switch_right_tab(page, "Live")

    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        cards = page.query_selector_all(".brew-agent-cards--runtime .brew-agent-card")
        if cards:
            print(f"  ✓  {len(cards)} agent card(s) on Live tab")
            shot(page, shots_dir, label)
            return len(cards)
        page.wait_for_timeout(800)
    shot(page, shots_dir, label + "-TIMEOUT")
    print("  ⚠  No runtime agent cards appeared on Live tab")
    return 0


def show_stage_outputs(page, shots_dir, label):
    """Screenshot the pipeline stage outputs section if visible."""
    stages = page.query_selector(".brew-brewcast-section-title, .pipeline-stage-outputs")
    if stages:
        stages.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        shot(page, shots_dir, label)
        print("  ✓  Stage outputs captured")
    else:
        print("  –  No stage output section visible")


def open_expand_popout(page, shots_dir, label, btn_index=0):
    """Open the nth expand popout and screenshot it."""
    btns = page.query_selector_all(".brew-agent-card-expand")
    if not btns:
        print("  –  No expand buttons visible")
        return
    idx = min(btn_index, len(btns) - 1)
    btns[idx].click()
    try:
        page.wait_for_selector(".brew-modal-backdrop", timeout=4_000)
        title = page.query_selector(".brew-modal-title-plain")
        print(f"  ✓  Popout: {title.inner_text() if title else 'agent'}")
        page.wait_for_timeout(600)
        shot(page, shots_dir, label)
    except Exception:
        print("  ⚠  Popout did not open")
    finally:
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)


def show_metrics_strip(page, shots_dir, label):
    """Scroll to and screenshot the run metrics strip if present."""
    strip = page.query_selector(".metrics-strip")
    if strip:
        strip.scroll_into_view_if_needed()
        page.wait_for_timeout(200)
        shot(page, shots_dir, label)
        print("  ✓  Metrics strip captured")
    else:
        print("  –  Metrics strip not visible")


# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------

def run_scenario(page, mode, prompt, shots_dir):
    os.makedirs(shots_dir, exist_ok=True)
    output_mov = shots_dir.rstrip("/") + ".mov"

    log(f"=== MLX DEMO: {mode} ===")

    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    clear_session(page)

    # Broadcast
    broadcast(page, prompt)

    # Show live tab during streaming
    wait_for_live_tab_agents(page, shots_dir, "live-tab-streaming")

    # Wait for completion
    wait_for_response(page, shots_dir, "response-complete")

    # Show metrics / stage outputs
    if mode == "PIPELINE":
        show_stage_outputs(page, shots_dir, "stage-outputs")
    show_metrics_strip(page, shots_dir, "metrics-strip")

    # Return to agents tab to show expand buttons
    switch_right_tab(page, "Agents")

    shot(page, shots_dir, "agents-tab-with-results")
    open_expand_popout(page, shots_dir, "popout-first-agent", btn_index=0)
    open_expand_popout(page, shots_dir, "popout-second-agent", btn_index=1)

    shot(page, shots_dir, "final")
    stitch_video(shots_dir, output_mov, frame_secs=FRAME_SECS)
    return output_mov


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(BASE_DIR, exist_ok=True)

    import urllib.request
    try:
        urllib.request.urlopen("http://localhost:3000", timeout=5)
    except Exception:
        print("❌  Dev server not reachable at http://localhost:3000", file=sys.stderr)
        print("    Run: npm start", file=sys.stderr)
        sys.exit(1)

    # Check MLX coordinator
    try:
        urllib.request.urlopen("http://localhost:3003/api/mlx/health", timeout=3)
    except Exception:
        print("❌  MLX coordinator not reachable at http://localhost:3003/api/mlx/health", file=sys.stderr)
        print("    Run: brewctl up  or start the MLX coordinator manually", file=sys.stderr)
        sys.exit(1)

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

            # Use MAX profile for MLX (scout + programmer on MLX)
            from demo_utils import select_profile, launch_and_wait_online
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

    log("=== MLX HERO COMPLETE ===")
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
