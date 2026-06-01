"""
Profile, launch, mode, RAG, and session helpers for demo scripts.
Split from demo_utils.py — import from demo_utils for backwards compat.
"""

from playwright.sync_api import TimeoutError as PWTimeout

LAUNCH_TMO       = 300_000   # 5 min — cold llama-server start
ONLINE_WARMUP_MS = 120_000   # 2 min extra warmup after ONLINE

PROFILE_VALUES = {
    "SAFE":     "safe",
    "BALANCED": "balanced",
    "MAX":      "max",
    "MIXED":    "mixed",
}


def select_profile(page, profile_name):
    """
    Select a profile via the brew-profile-select <select> element.
    profile_name: 'SAFE' | 'BALANCED' | 'MAX' | 'MIXED'
    """
    from demo_utils import log
    log(f"Selecting profile: {profile_name}")
    value = PROFILE_VALUES.get(profile_name.upper())
    if not value:
        raise RuntimeError(f"Unknown profile '{profile_name}'. Valid: {list(PROFILE_VALUES)}")
    page.select_option(".brew-profile-select", value=value)
    page.wait_for_timeout(600)
    print(f"  ✓  Profile '{profile_name}' selected")


def launch_and_wait_online(page, shots_dir=None):
    """Click the BREW button and wait until the status pill shows ONLINE."""
    from demo_utils import log, shot
    log("Launching swarm…")
    btn = page.query_selector(".brew-launch-btn")
    if not btn:
        raise RuntimeError(".brew-launch-btn not found")
    btn.click()
    print("  … waiting for ONLINE (up to 5 min)…")
    try:
        page.wait_for_selector(".brew-status-pill.online", timeout=LAUNCH_TMO)
    except PWTimeout:
        if shots_dir:
            shot(page, shots_dir, "LAUNCH-TIMEOUT")
        raise RuntimeError("Timed out waiting for swarm to come ONLINE")
    print("  ✓  Swarm ONLINE")
    print(f"  … warming up ({ONLINE_WARMUP_MS // 1000}s)…")
    page.wait_for_timeout(ONLINE_WARMUP_MS)


def set_mode(page, mode_name):
    """
    Switch orchestration mode via the ModeSelector popover.
    mode_name: 'ROUTER' | 'FLAT' | 'CASCADE' | 'PIPELINE'
    """
    from demo_utils import log
    log(f"Setting mode: {mode_name}")
    mode_btn = page.query_selector(".mode-button")
    if not mode_btn:
        raise RuntimeError(".mode-button not found")
    mode_btn.click()
    page.wait_for_selector(".mode-popover", timeout=5_000)
    for opt in page.query_selector_all(".mode-option"):
        if mode_name.upper() in opt.inner_text().upper():
            opt.click()
            page.wait_for_timeout(500)
            print(f"  ✓  Mode → {mode_name}")
            return
    page.keyboard.press("Escape")
    raise RuntimeError(f"Mode option '{mode_name}' not found in popover")


def enable_rag(page):
    """Check the RAG toggle if it is not already on and not disabled."""
    cb = page.query_selector(".rag-toggle input[type=checkbox]")
    if not cb:
        print("  ⚠  RAG checkbox not found — skipping")
        return
    if page.evaluate("el => el.disabled", cb):
        print("  ⚠  RAG checkbox disabled (pgvector unavailable) — skipping")
        return
    if not page.evaluate("el => el.checked", cb):
        cb.click()
        page.wait_for_timeout(300)
    print("  ✓  RAG enabled")


def clear_session(page):
    """Click '✕ new session' to start a fresh conversation."""
    btn = page.get_by_title("Clear session")
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(400)
        print("  ✓  Session cleared")
    else:
        print("  –  No active session to clear")
