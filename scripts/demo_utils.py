"""
Shared Playwright helpers for Brewlatte demo scripts.
Updated for Brewlatte 2.1.0 CSS class names.

Broadcast/response/video helpers live in demo_utils_broadcast.py;
re-exported here for backwards compat.
"""

import os

from playwright.sync_api import TimeoutError as PWTimeout

APP_URL     = "http://localhost:3000?theme=dark"
LAUNCH_TMO  = 300_000   # 5 min — cold llama-server start
RESP_TMO    = 600_000   # 10 min per broadcast
POLL_MS     = 1_500
ONLINE_WARMUP_MS = 120_000  # 2 min extra after ONLINE before first broadcast

# Profile option values in the brew-profile-select <select>
PROFILE_VALUES = {
    "SAFE":     "safe",
    "BALANCED": "balanced",
    "MAX":      "max",
    "MIXED":    "mixed",
}


# ---------------------------------------------------------------------------
# Logging / screenshots
# ---------------------------------------------------------------------------

def log(msg):
    bar = "─" * 60
    print(f"\n{bar}\n{msg}\n{bar}")


def shot(page, shots_dir, label):
    """Save a numbered screenshot; returns the path."""
    existing = len([f for f in os.listdir(shots_dir) if f.endswith(".png")])
    path = os.path.join(shots_dir, f"{existing + 1:03d}-{label}.png")
    page.screenshot(path=path)
    print(f"  📸  {path}")
    return path


# ---------------------------------------------------------------------------
# Configure panel
# — In Brewlatte the left panel is always visible; these are no-ops kept
#   for script compatibility.
# ---------------------------------------------------------------------------

def ensure_config_open(page):
    """No-op: Brewlatte left panel is always visible."""
    pass


def ensure_config_closed(page):
    """No-op: Brewlatte left panel is always visible."""
    pass


# ---------------------------------------------------------------------------
# Profile & launch
# ---------------------------------------------------------------------------

def select_profile(page, profile_name):
    """
    Select a profile via the brew-profile-select <select> element.
    profile_name: 'SAFE' | 'BALANCED' | 'MAX' | 'MIXED'
    """
    log(f"Selecting profile: {profile_name}")
    value = PROFILE_VALUES.get(profile_name.upper())
    if not value:
        raise RuntimeError(f"Unknown profile '{profile_name}'. Valid: {list(PROFILE_VALUES)}")
    page.select_option(".brew-profile-select", value=value)
    page.wait_for_timeout(600)
    print(f"  ✓  Profile '{profile_name}' selected")


def launch_and_wait_online(page, shots_dir=None):
    """Click the BREW button and wait until the status pill shows ONLINE."""
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


# ---------------------------------------------------------------------------
# Mode
# ---------------------------------------------------------------------------

def set_mode(page, mode_name):
    """
    Switch orchestration mode via the ModeSelector popover.
    mode_name: 'ROUTER' | 'FLAT' | 'CASCADE' | 'PIPELINE'
    """
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


# ---------------------------------------------------------------------------
# RAG & session
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Right-panel tab switching
# ---------------------------------------------------------------------------

def switch_right_tab(page, tab_label):
    """
    Click a right-panel tab by label.
    tab_label: 'Session' | 'Agents' | 'Modes' | 'Live' | 'RAG'
    """
    for tab in page.query_selector_all(".brew-right-tab"):
        if tab_label.lower() in tab.inner_text().lower():
            tab.click()
            page.wait_for_timeout(400)
            print(f"  ✓  Right tab → {tab_label}")
            return
    print(f"  ⚠  Right tab '{tab_label}' not found")


# ---------------------------------------------------------------------------
# Backwards-compat re-exports from demo_utils_broadcast
# ---------------------------------------------------------------------------

from demo_utils_broadcast import (  # noqa: E402
    broadcast,
    wait_for_response,
    follow_up,
    wait_for_agents_ready,
    stitch_video,
)

__all__ = [
    "APP_URL", "LAUNCH_TMO", "RESP_TMO", "POLL_MS", "ONLINE_WARMUP_MS",
    "PROFILE_VALUES",
    "log", "shot",
    "ensure_config_open", "ensure_config_closed",
    "select_profile", "launch_and_wait_online",
    "set_mode",
    "enable_rag", "clear_session",
    "switch_right_tab",
    "broadcast", "wait_for_response", "follow_up",
    "wait_for_agents_ready", "stitch_video",
]
