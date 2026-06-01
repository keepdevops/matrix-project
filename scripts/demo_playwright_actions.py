"""
Local Playwright action helpers for demo_playwright.py.
These mirror demo_utils but target the older Swarm Matrix CSS selectors.
"""

import time

from playwright.sync_api import TimeoutError as PWTimeout

LAUNCH_TMO = 300_000   # 5 min
RESP_TMO   = 180_000   # 3 min per broadcast
POLL_MS    = 1_500


def shot(page, shots_dir, shot_idx, label):
    """Save a numbered screenshot; mutates shot_idx[0]. Returns path."""
    shot_idx[0] += 1
    path = f"{shots_dir}/{shot_idx[0]:02d}-{label}.png"
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
        page.get_by_role("button", name="CONFIGURE").click()
        page.wait_for_timeout(400)


def select_profile(page, profile_name):
    """Click a profile button (SAFE | BALANCED | MAX | MIXED)."""
    log(f"Selecting profile: {profile_name}")
    ensure_config_open(page)
    btns = page.query_selector_all(".swarm-profile-btn")
    for b in btns:
        if profile_name.upper() in b.inner_text().upper():
            b.click()
            page.wait_for_timeout(500)
            print(f"  ✓  Profile '{profile_name}' selected")
            return
    raise RuntimeError(f"Profile button '{profile_name}' not found")


def launch_and_wait_online(page, shots_dir, shot_idx):
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
        shot(page, shots_dir, shot_idx, "LAUNCH-TIMEOUT")
        raise RuntimeError("Timed out waiting for swarm to come ONLINE")
    print("  ✓  Swarm ONLINE")
    page.wait_for_timeout(800)


def set_mode(page, mode_name):
    """Switch orchestration mode (ROUTER | FLAT | CASCADE | PIPELINE)."""
    log(f"Setting mode: {mode_name}")
    page.query_selector(".mode-button").click()
    page.wait_for_selector(".mode-popover", timeout=3_000)
    for opt in page.query_selector_all(".mode-option"):
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
    page.get_by_role("button", name="BROADCAST").click()
    print("  … broadcasting…")


def wait_for_response(page, shots_dir, shot_idx, label):
    """
    Wait until .ct-thinking is gone and BROADCAST button is re-enabled.
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
            shot(page, shots_dir, shot_idx, label)
            return n
    shot(page, shots_dir, shot_idx, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, shots_dir, shot_idx, label):
    """Type a follow-up in the conversation reply box and click SEND."""
    log(f"Follow-up: {prompt_text[:60]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button").click()
    print("  … waiting for follow-up response…")
    return wait_for_response(page, shots_dir, shot_idx, label)
