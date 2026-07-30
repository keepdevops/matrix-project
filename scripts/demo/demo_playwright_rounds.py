"""
Round helpers for demo_playwright.py.
Each function drives one scenario round end-to-end.
"""

from demo_playwright_actions import (
    ensure_config_closed, select_profile, launch_and_wait_online,
    set_mode, broadcast, wait_for_response, follow_up,
)


def run_round_a(page, shots_dir, shot_idx, PROMPTS, shot, wait, follow):
    """BALANCED profile → ROUTER mode → 2 prompts + 1 follow-up."""
    from demo_utils import log
    log("=== ROUND A: BALANCED → ROUTER ===")

    select_profile(page, "BALANCED")
    shot(page, "01-balanced-selected")
    launch_and_wait_online(page, shots_dir, shot_idx)
    shot(page, "02-online-after-balanced-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)
    set_mode(page, "ROUTER")
    shot(page, "03-router-mode-set")

    broadcast(page, PROMPTS[1], 1)
    wait(page, "04-router-prompt1-response")
    follow(page, PROMPTS[2], "05-router-followup-response")


def run_round_b(page, shots_dir, shot_idx, PROMPTS, shot, wait):
    """FLAT mode — swarm stays online, no re-launch."""
    from demo_utils import log
    log("=== ROUND B: FLAT mode (swarm stays online) ===")

    set_mode(page, "FLAT")
    shot(page, "06-flat-mode-set")
    broadcast(page, PROMPTS[3], 3)
    wait(page, "07-flat-prompt3-response")


def run_round_c(page, shots_dir, shot_idx, PROMPTS, shot, wait, follow):
    """SAFE profile re-launch → CASCADE mode → 1 prompt + 1 follow-up."""
    from demo_utils import log
    log("=== ROUND C: SAFE profile re-launch → CASCADE ===")

    select_profile(page, "SAFE")
    shot(page, "08-safe-selected")
    launch_and_wait_online(page, shots_dir, shot_idx)
    shot(page, "09-online-after-safe-launch")

    ensure_config_closed(page)
    page.wait_for_timeout(500)
    set_mode(page, "CASCADE")
    shot(page, "10-cascade-mode-set")

    broadcast(page, PROMPTS[4], 4)
    wait(page, "11-cascade-prompt4-response")
    follow(page, PROMPTS[5], "12-cascade-followup-final")
