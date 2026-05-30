"""
Shared Playwright helpers for Swarm Matrix demo scripts.
Used by demo_playwright.py and hero_demo.py.
"""

import os
import subprocess
import sys
import time

from playwright.sync_api import TimeoutError as PWTimeout

APP_URL     = "http://localhost:3000?theme=dark"
LAUNCH_TMO  = 300_000   # 5 min — cold llama-server start
RESP_TMO    = 300_000   # 5 min per broadcast
POLL_MS     = 1_500


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
# ---------------------------------------------------------------------------

def ensure_config_open(page):
    if not page.is_visible(".swarm-deploy-btn"):
        page.get_by_role("button", name="CONFIGURE").click()
        page.wait_for_selector(".swarm-deploy-btn", timeout=5_000)


def ensure_config_closed(page):
    if page.is_visible(".swarm-deploy-btn"):
        page.get_by_role("button", name="CONFIGURE").click()
        page.wait_for_timeout(400)


# ---------------------------------------------------------------------------
# Profile & launch
# ---------------------------------------------------------------------------

def select_profile(page, profile_name):
    log(f"Selecting profile: {profile_name}")
    ensure_config_open(page)
    for btn in page.query_selector_all(".swarm-profile-btn"):
        if profile_name.upper() in btn.inner_text().upper():
            btn.click()
            page.wait_for_timeout(500)
            print(f"  ✓  Profile '{profile_name}' selected")
            return
    raise RuntimeError(f"Profile button '{profile_name}' not found")


def launch_and_wait_online(page, shots_dir=None):
    log("Launching swarm…")
    ensure_config_open(page)
    btn = page.query_selector(".swarm-deploy-btn")
    if not btn:
        raise RuntimeError(".swarm-deploy-btn not found")
    btn.click()
    print("  … waiting for ONLINE (up to 5 min)…")
    try:
        page.wait_for_selector(".status-online", timeout=LAUNCH_TMO)
    except PWTimeout:
        if shots_dir:
            shot(page, shots_dir, "LAUNCH-TIMEOUT")
        raise RuntimeError("Timed out waiting for swarm to come ONLINE")
    print("  ✓  Swarm ONLINE")
    page.wait_for_timeout(800)


# ---------------------------------------------------------------------------
# Mode
# ---------------------------------------------------------------------------

def set_mode(page, mode_name):
    log(f"Setting mode: {mode_name}")
    page.query_selector(".mode-button").click()
    page.wait_for_selector(".mode-popover", timeout=3_000)
    for opt in page.query_selector_all(".mode-option"):
        if mode_name.upper() in opt.inner_text().upper():
            opt.click()
            page.wait_for_timeout(400)
            print(f"  ✓  Mode → {mode_name}")
            return
    raise RuntimeError(f"Mode option '{mode_name}' not found")


# ---------------------------------------------------------------------------
# RAG & session
# ---------------------------------------------------------------------------

def enable_rag(page):
    """Check the RAG checkbox if it is not already on and not disabled."""
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
    """Click ✕ new session in the conversation header to start fresh."""
    btn = page.get_by_role("button", name="new session")
    if btn.count():
        btn.first.click()
        page.wait_for_timeout(400)
        print("  ✓  Session cleared")
    else:
        print("  –  No active session to clear")


# ---------------------------------------------------------------------------
# Broadcast & response
# ---------------------------------------------------------------------------

def broadcast(page, prompt_text, prompt_num=None):
    label = f"#{prompt_num}" if prompt_num else ""
    log(f"Broadcast {label}: {prompt_text[:65]}…")
    ta = page.query_selector(".prompt-textarea")
    if not ta:
        raise RuntimeError(".prompt-textarea not found")
    ta.click()
    ta.fill(prompt_text)
    page.query_selector(".prompt-input button[type=submit]").click()
    print("  … broadcasting…")


def wait_for_response(page, shots_dir, label):
    """
    Poll until .ct-thinking is gone and BROADCAST is re-enabled.
    Returns the turn count in the thread.
    """
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)
        thinking = page.query_selector(".ct-thinking")
        btn_disabled = page.evaluate(
            "() => { const b = document.querySelector('.prompt-input button[type=submit]');"
            " return b ? b.disabled : true; }"
        )
        if not thinking and not btn_disabled:
            turns = len(page.query_selector_all(".ct-turn"))
            print(f"  ✓  Response complete — {turns} turn(s)")
            shot(page, shots_dir, label)
            return turns
    shot(page, shots_dir, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, shots_dir, label):
    log(f"Follow-up: {prompt_text[:65]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button").click()
    print("  … waiting for follow-up…")
    return wait_for_response(page, shots_dir, label)


# ---------------------------------------------------------------------------
# Video stitching
# ---------------------------------------------------------------------------

def stitch_video(shots_dir, output_mov, frame_secs=2):
    """
    Rename screenshots to sequential 001.png … NNN.png in a temp subdir,
    then call ffmpeg to produce a ProRes .mov at 1/frame_secs fps.
    """
    frames_dir = shots_dir + "_frames"
    os.makedirs(frames_dir, exist_ok=True)

    pngs = sorted(f for f in os.listdir(shots_dir) if f.endswith(".png"))
    for i, fname in enumerate(pngs):
        src = os.path.join(shots_dir, fname)
        dst = os.path.join(frames_dir, f"{i + 1:03d}.png")
        if not os.path.exists(dst):
            os.symlink(os.path.abspath(src), dst)

    cmd = [
        "ffmpeg", "-y",
        "-framerate", f"1/{frame_secs}",
        "-i", os.path.join(frames_dir, "%03d.png"),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "prores_ks",
        "-profile:v", "3",
        "-pix_fmt", "yuv422p10le",
        output_mov,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ⚠  ffmpeg error:\n{result.stderr[-400:]}", file=sys.stderr)
    else:
        size_mb = os.path.getsize(output_mov) / (1024 * 1024)
        print(f"  🎬  {output_mov}  ({size_mb:.1f} MB)")
