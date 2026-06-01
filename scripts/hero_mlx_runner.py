"""
MLX-specific Playwright helpers and scenario runner for hero_mlx.py.
"""

import os
import time

from demo_utils import (
    log, shot,
    set_mode, clear_session,
    broadcast, wait_for_response,
    switch_right_tab, stitch_video,
)


def switch_to_mlx_backend(page):
    """Click the MLX backend toggle if available."""
    btn = page.query_selector(".brew-backend-mlx, [data-backend='mlx'], button.mlx-btn")
    if btn:
        btn.click()
        page.wait_for_timeout(400)
        print("  ✓  Switched to MLX backend")
    else:
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


def run_scenario(page, mode, prompt, shots_dir, frame_secs=2):
    """Run a single MLX demo scenario; returns the output .mov path."""
    os.makedirs(shots_dir, exist_ok=True)
    output_mov = shots_dir.rstrip("/") + ".mov"

    log(f"=== MLX DEMO: {mode} ===")

    set_mode(page, mode)
    shot(page, shots_dir, "mode-set")
    clear_session(page)

    broadcast(page, prompt)
    wait_for_live_tab_agents(page, shots_dir, "live-tab-streaming")
    wait_for_response(page, shots_dir, "response-complete")

    if mode == "PIPELINE":
        show_stage_outputs(page, shots_dir, "stage-outputs")
    show_metrics_strip(page, shots_dir, "metrics-strip")

    switch_right_tab(page, "Agents")
    shot(page, shots_dir, "agents-tab-with-results")
    open_expand_popout(page, shots_dir, "popout-first-agent", btn_index=0)
    open_expand_popout(page, shots_dir, "popout-second-agent", btn_index=1)

    shot(page, shots_dir, "final")
    stitch_video(shots_dir, output_mov, frame_secs=frame_secs)
    return output_mov
