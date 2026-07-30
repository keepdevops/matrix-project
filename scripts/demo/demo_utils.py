"""
Shared Playwright helpers for Brewlatte demo scripts.
Updated for Brewlatte 2.1.0 CSS class names.

Profile/launch/mode/session helpers live in demo_utils_launch.py;
broadcast/response/video helpers live in demo_utils_broadcast.py.
Both are re-exported here for backwards compat.
"""

import os

APP_URL  = "http://localhost:3000?theme=dark"
POLL_MS  = 1_500


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
# Configure panel no-ops (Brewlatte left panel is always visible)
# ---------------------------------------------------------------------------

def ensure_config_open(page):
    pass


def ensure_config_closed(page):
    pass


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
# Backwards-compat re-exports
# ---------------------------------------------------------------------------

from demo_utils_launch import (  # noqa: E402
    select_profile,
    launch_and_wait_online,
    set_mode,
    enable_rag,
    clear_session,
)

from demo_utils_broadcast import (  # noqa: E402
    broadcast,
    wait_for_response,
    follow_up,
)

from demo_utils_video import (  # noqa: E402
    wait_for_agents_ready,
    stitch_video,
)

__all__ = [
    "APP_URL", "POLL_MS",
    "log", "shot",
    "ensure_config_open", "ensure_config_closed",
    "switch_right_tab",
    "select_profile", "launch_and_wait_online", "set_mode", "enable_rag", "clear_session",
    "broadcast", "wait_for_response", "follow_up", "wait_for_agents_ready", "stitch_video",
]
