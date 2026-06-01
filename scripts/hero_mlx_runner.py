"""
MLX-specific Playwright helpers and scenario runner for hero_mlx.py.
"""

import os

from demo_utils import (
    log, shot,
    set_mode, clear_session,
    broadcast, wait_for_response,
    switch_right_tab, stitch_video,
)
from hero_mlx_visual import (
    wait_for_live_tab_agents, show_stage_outputs,
    open_expand_popout, show_metrics_strip,
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
