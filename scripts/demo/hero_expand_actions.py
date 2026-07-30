"""
Right-panel runtime expand helpers and scenario runner for hero_expand.py.
"""

import os
import time

from demo_utils import (
    log, shot,
    set_mode, clear_session,
    broadcast, wait_for_response,
    wait_for_agents_ready, switch_right_tab, stitch_video,
)

FRAME_SECS = 2


def wait_for_runtime_expand_buttons(page, shots_dir, label, min_count=1, timeout_ms=15_000):
    """Wait for ⤢ buttons on runtime agent cards in the right-panel Agents tab."""
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        btns = page.query_selector_all(".brew-agent-cards--runtime button[title='Popout']")
        if len(btns) >= min_count:
            print(f"  ✓  {len(btns)} runtime expand button(s) visible")
            shot(page, shots_dir, label)
            return btns
        page.wait_for_timeout(500)
    shot(page, shots_dir, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for {min_count} runtime expand button(s)")


def open_runtime_expand_popout(page, shots_dir, btn_index, label):
    """Click the nth ⤢ button on a runtime agent card and screenshot the popout."""
    btns = page.query_selector_all(".brew-agent-cards--runtime button[title='Popout']")
    if btn_index >= len(btns):
        print(f"  ⚠  expand button [{btn_index}] not available ({len(btns)} total) — skipping")
        return
    btns[btn_index].click()
    page.wait_for_selector(".brew-modal-backdrop", timeout=4_000)
    title = page.query_selector(".brew-modal-title-plain")
    print(f"  ✓  Popout open: {title.inner_text() if title else 'agent'}")
    page.wait_for_timeout(600)
    shot(page, shots_dir, label)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    print("  ✓  Popout closed")


def run_scenario(page, mode, prompt, shots_dir):
    """Run one expand demo scenario; returns the output .mov path."""
    os.makedirs(shots_dir, exist_ok=True)
    output_mov = shots_dir.rstrip("/") + ".mov"

    log(f"=== EXPAND DEMO: {mode} ===")

    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    clear_session(page)
    wait_for_agents_ready(page)

    broadcast(page, prompt)
    wait_for_response(page, shots_dir, "response-complete")

    switch_right_tab(page, "Agents")
    shot(page, shots_dir, "agents-tab-results")

    btns = wait_for_runtime_expand_buttons(page, shots_dir, "expand-buttons-visible")
    for i in range(min(3, len(btns))):
        open_runtime_expand_popout(page, shots_dir, i, f"popout-agent-{i + 1}")
        page.wait_for_timeout(200)

    shot(page, shots_dir, "after-popouts")
    stitch_video(shots_dir, output_mov, frame_secs=FRAME_SECS)
    return output_mov
