#!/usr/bin/env python3
"""
Brewlatte 2.1.0 hero video — left-panel agent expand / brewcast popout.

Demonstrates the new ⤢ expand button that appears on Configure-panel
agent cards after a brewcast run, letting users view the full response
and code output without switching tabs.

Scenario (one launch, two modes):
  1. BALANCED profile → ROUTER mode  → broadcast → expand 3 agents
  2. Same launch     → PIPELINE mode → broadcast → expand 3 agents + show code

Output: /tmp/hero-expand/{scenario}.mov  (ProRes, 2 s/frame)

Usage:
    /Users/caribou/miniforge3/envs/mlx-env/bin/python3 scripts/hero_expand.py

Prerequisites:
    - Dev server:  npm start          (http://localhost:3000)
    - Coordinator: brewctl up         (proxy + llama-server)
"""

import os
import sys

from playwright.sync_api import sync_playwright

from demo_utils import (
    APP_URL, log, shot,
    select_profile, launch_and_wait_online,
    set_mode, clear_session,
    broadcast, wait_for_response,
    wait_for_agents_ready, stitch_video,
)

BASE_DIR   = "/tmp/hero-expand"
FRAME_SECS = 2

PROMPT_ROUTER = (
    "Write a Python async HTTP client that retries on 429/503 with "
    "exponential backoff and jitter, returning structured error objects"
)
PROMPT_PIPELINE = (
    "Design and implement a Go middleware chain: rate-limiting → "
    "JWT auth → request-ID injection → structured JSON logging"
)


# ---------------------------------------------------------------------------
# Expand helpers
# ---------------------------------------------------------------------------

def wait_for_expand_buttons(page, shots_dir, label, min_count=1, timeout_ms=10_000):
    """Poll until at least min_count .brew-agent-card-expand buttons appear."""
    import time
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        btns = page.query_selector_all(".brew-agent-card-expand")
        if len(btns) >= min_count:
            print(f"  ✓  {len(btns)} expand button(s) visible")
            shot(page, shots_dir, label)
            return btns
        page.wait_for_timeout(500)
    shot(page, shots_dir, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for {min_count} expand button(s)")


def open_expand_popout(page, shots_dir, btn_index, label):
    """Click the nth expand button and screenshot the popout."""
    btns = page.query_selector_all(".brew-agent-card-expand")
    if btn_index >= len(btns):
        print(f"  ⚠  expand button [{btn_index}] not available ({len(btns)} total) — skipping")
        return
    btns[btn_index].click()
    page.wait_for_selector(".brew-modal-backdrop", timeout=4_000)
    title = page.query_selector(".brew-modal-title-plain")
    title_text = title.inner_text() if title else "unknown"
    print(f"  ✓  Popout open: {title_text}")
    page.wait_for_timeout(600)   # let code block render
    shot(page, shots_dir, label)
    # Close via Escape
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    print(f"  ✓  Popout closed")


def scroll_to_agent(page, agent_name):
    """Scroll the left-panel agent grid so agent_name is visible."""
    page.evaluate(
        """(name) => {
            const cards = document.querySelectorAll('.brew-agent-card-name');
            for (const c of cards) {
                if (c.textContent.trim().toUpperCase() === name.toUpperCase()) {
                    c.closest('.brew-agent-card').scrollIntoView({ block: 'center' });
                    return;
                }
            }
        }""",
        agent_name,
    )
    page.wait_for_timeout(300)


# ---------------------------------------------------------------------------
# Scenario runner
# ---------------------------------------------------------------------------

def run_scenario(page, mode, prompt, shots_dir):
    os.makedirs(shots_dir, exist_ok=True)
    output_mov = shots_dir.rstrip("/") + ".mov"

    log(f"=== EXPAND DEMO: {mode} ===")

    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    clear_session(page)
    wait_for_agents_ready(page)

    # Broadcast
    broadcast(page, prompt)
    wait_for_response(page, shots_dir, "response-complete")

    # Show the left panel with result dots visible
    shot(page, shots_dir, "left-panel-result-dots")

    # Open the first three expand popouts
    btns = wait_for_expand_buttons(page, shots_dir, "expand-buttons-visible", min_count=1)
    for i in range(min(3, len(btns))):
        open_expand_popout(page, shots_dir, i, f"popout-agent-{i + 1}")
        # Re-query after close — DOM unchanged but safer
        page.wait_for_timeout(200)

    shot(page, shots_dir, "after-popouts")
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

    all_videos = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
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
            page.wait_for_timeout(500)

            for i, (mode, prompt) in enumerate([
                ("ROUTER",   PROMPT_ROUTER),
                ("PIPELINE", PROMPT_PIPELINE),
            ]):
                if i > 0:
                    wait_for_agents_ready(page, shots_dir=launch_dir)
                shots_dir = os.path.join(BASE_DIR, mode.lower())
                try:
                    mov = run_scenario(page, mode, prompt, shots_dir)
                    all_videos.append(mov)
                except Exception as exc:
                    print(f"\n❌  {mode} scenario failed: {exc}", file=sys.stderr)
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

    log("=== EXPAND HERO COMPLETE ===")
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
