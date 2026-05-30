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
import time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

APP_URL    = "http://localhost:3000?theme=dark"
SHOTS_DIR  = "/tmp/matrix-demo"
PY         = sys.executable          # already the mlx-env python
LAUNCH_TMO = 300_000                 # 5 min — cold-start llama-server can be slow
RESP_TMO   = 180_000                 # 3 min per broadcast
POLL_MS    = 1_500

PROMPTS = {
    1: "Write a Go HTTP server with a /health endpoint that returns JSON",
    2: "Add middleware to log every request with method, path, and latency",
    3: "Refactor the server to use graceful shutdown on SIGTERM",
    4: "Add a /metrics endpoint that returns uptime and total requests served",
    5: "Write tests for the /health and /metrics endpoints using httptest",
}

os.makedirs(SHOTS_DIR, exist_ok=True)
shot_idx = [0]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def shot(page, label):
    shot_idx[0] += 1
    path = f"{SHOTS_DIR}/{shot_idx[0]:02d}-{label}.png"
    page.screenshot(path=path)
    print(f"  📸  {path}")
    return path


def log(msg):
    print(f"\n{'─'*60}\n{msg}\n{'─'*60}")


def ensure_config_open(page):
    """Open the configure panel if it is not already visible."""
    if not page.is_visible(".swarm-deploy-btn"):
        page.get_by_role("button", name="CONFIGURE").click()
        page.wait_for_selector(".swarm-deploy-btn", timeout=5_000)


def ensure_config_closed(page):
    """Close the configure panel if it is open."""
    if page.is_visible(".swarm-deploy-btn"):
        # Click CONFIGURE toggle to close
        page.get_by_role("button", name="CONFIGURE").click()
        page.wait_for_timeout(400)


def select_profile(page, profile_name):
    """Click a profile button (SAFE | BALANCED | MAX | MIXED)."""
    log(f"Selecting profile: {profile_name}")
    ensure_config_open(page)
    # Profile buttons use text labels inside .swarm-profile-btn
    btns = page.query_selector_all(".swarm-profile-btn")
    target = None
    for b in btns:
        if profile_name.upper() in b.inner_text().upper():
            target = b
            break
    if not target:
        raise RuntimeError(f"Profile button '{profile_name}' not found")
    target.click()
    page.wait_for_timeout(500)
    print(f"  ✓  Profile '{profile_name}' selected")


def launch_and_wait_online(page):
    """Click LAUNCH SWARM and wait until ● ONLINE."""
    log("Launching swarm…")
    ensure_config_open(page)
    launch_btn = page.query_selector(".swarm-deploy-btn")
    if not launch_btn:
        raise RuntimeError(".swarm-deploy-btn not found")
    launch_btn.click()
    print("  … waiting for ONLINE (up to 5 min)…")
    try:
        page.wait_for_selector(".status-online", timeout=LAUNCH_TMO)
    except PWTimeout:
        shot(page, "LAUNCH-TIMEOUT")
        raise RuntimeError("Timed out waiting for swarm to come ONLINE")
    print("  ✓  Swarm ONLINE")
    page.wait_for_timeout(800)


def set_mode(page, mode_name):
    """Switch orchestration mode (ROUTER | FLAT | CASCADE | PIPELINE)."""
    log(f"Setting mode: {mode_name}")
    page.query_selector(".mode-button").click()
    page.wait_for_selector(".mode-popover", timeout=3_000)
    options = page.query_selector_all(".mode-option")
    for opt in options:
        if mode_name.upper() in opt.inner_text().upper():
            opt.click()
            page.wait_for_timeout(400)
            print(f"  ✓  Mode set to {mode_name}")
            return
    raise RuntimeError(f"Mode option '{mode_name}' not found in popover")


def broadcast(page, prompt_text, prompt_num):
    """Fill the main prompt textarea and click BROADCAST."""
    log(f"Broadcast prompt #{prompt_num}: {prompt_text[:60]}…")
    ta = page.query_selector(".prompt-textarea")
    if not ta:
        raise RuntimeError(".prompt-textarea not found")
    ta.click()
    ta.fill(prompt_text)
    # Click BROADCAST button
    page.get_by_role("button", name="BROADCAST").click()
    print("  … broadcasting…")


def wait_for_response(page, label, prev_turn_count=None):
    """
    Wait until:
      - .ct-thinking is gone  (swarm response rendered)
      - BROADCAST button is re-enabled
    Returns the new turn count.
    """
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)
        thinking = page.query_selector(".ct-thinking")
        broadcast_disabled = page.evaluate(
            "() => { const b = document.querySelector('.prompt-input button'); return b ? b.disabled : true; }"
        )
        if not thinking and not broadcast_disabled:
            turns = page.query_selector_all(".ct-turn")
            n = len(turns)
            print(f"  ✓  Response complete — {n} turn(s) in thread")
            shot(page, label)
            return n
    shot(page, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, label):
    """Type a follow-up in the conversation reply box and click SEND."""
    log(f"Follow-up: {prompt_text[:60]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button").click()
    print("  … waiting for follow-up response…")
    return wait_for_response(page, label)


# ---------------------------------------------------------------------------
# Main demo
# ---------------------------------------------------------------------------

def run_demo(page):
    log("Loading Swarm Matrix…")
    page.goto(APP_URL, wait_until="domcontentloaded", timeout=15_000)
    page.wait_for_timeout(3_000)
    shot(page, "00-initial-load")

    # ── Round A: BALANCED profile, ROUTER mode ───────────────────────────────
    log("=== ROUND A: BALANCED → ROUTER ===")

    select_profile(page, "BALANCED")
    shot(page, "01-balanced-selected")

    launch_and_wait_online(page)
    shot(page, "02-online-after-balanced-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    set_mode(page, "ROUTER")
    shot(page, "03-router-mode-set")

    broadcast(page, PROMPTS[1], 1)
    n = wait_for_response(page, "04-router-prompt1-response")

    follow_up(page, PROMPTS[2], "05-router-followup-response")

    # ── Round B: FLAT mode, no re-launch ─────────────────────────────────────
    log("=== ROUND B: FLAT mode (swarm stays online) ===")

    set_mode(page, "FLAT")
    shot(page, "06-flat-mode-set")

    broadcast(page, PROMPTS[3], 3)
    wait_for_response(page, "07-flat-prompt3-response")

    # ── Round C: SAFE profile re-launch, CASCADE mode ────────────────────────
    log("=== ROUND C: SAFE profile re-launch → CASCADE ===")

    select_profile(page, "SAFE")
    shot(page, "08-safe-selected")

    launch_and_wait_online(page)
    shot(page, "09-online-after-safe-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)

    set_mode(page, "CASCADE")
    shot(page, "10-cascade-mode-set")

    broadcast(page, PROMPTS[4], 4)
    wait_for_response(page, "11-cascade-prompt4-response")

    follow_up(page, PROMPTS[5], "12-cascade-followup-final")

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
            shot(page, "ERROR-state")
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
