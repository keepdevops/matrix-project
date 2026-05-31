"""
Shared Playwright helpers for Brewlatte demo scripts.
Updated for Brewlatte 2.1.0 CSS class names.
"""

import os
import subprocess
import sys
import time

from playwright.sync_api import TimeoutError as PWTimeout

APP_URL     = "http://localhost:3000?theme=dark"
LAUNCH_TMO  = 300_000   # 5 min — cold llama-server start
RESP_TMO    = 600_000   # 10 min per broadcast — first-load model warmup can be slow
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
    # Wait for model weights to finish loading before first broadcast.
    # The status pill turns green when the coordinator passes a health check,
    # but the first inference request can still be queued behind model loading.
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
# Broadcast & response
# ---------------------------------------------------------------------------

def broadcast(page, prompt_text, prompt_num=None):
    """Fill the prompt textarea and submit."""
    label = f"#{prompt_num}" if prompt_num else ""
    log(f"Broadcast {label}: {prompt_text[:65]}…")
    # Ensure the Session tab is active — PromptInput is only rendered there.
    switch_right_tab(page, "Session")
    page.wait_for_timeout(300)
    ta = page.query_selector(".prompt-textarea")
    if not ta:
        raise RuntimeError(".prompt-textarea not found")
    ta.click()
    ta.fill(prompt_text)
    page.query_selector(".prompt-input button[type=submit]").click()
    print("  … broadcasting…")


def wait_for_response(page, shots_dir, label):
    """
    Poll until the broadcast completes. Completion is signalled by ANY of:
      - A new completed .ct-turn (non-pending) appearing since we started
      - .ct-thinking gone AND submit button re-enabled
    Returns the current turn count.
    """
    # Baseline: how many completed turns exist before we started
    baseline = page.evaluate(
        "() => document.querySelectorAll('.ct-turn:not(.ct-turn--pending)').length"
    )
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)

        # Primary signal: a new completed turn with non-empty SWARM text
        completed = page.evaluate(
            """() => {
                const turns = document.querySelectorAll('.ct-turn:not(.ct-turn--pending)');
                return Array.from(turns).filter(t => {
                    const txt = t.querySelector('.ct-bubble--swarm .ct-bubble-text');
                    return txt && txt.textContent.trim().length > 20;
                }).length;
            }"""
        )
        if completed > baseline:
            turns = page.evaluate("() => document.querySelectorAll('.ct-turn').length")
            print(f"  ✓  Response complete — {turns} turn(s)")
            shot(page, shots_dir, label)
            return turns

        # Fallback: thinking gone + button enabled
        thinking = page.query_selector(".ct-thinking")
        btn_disabled = page.evaluate(
            "() => { const b = document.querySelector('.prompt-input button[type=submit]');"
            " return b ? b.disabled : true; }"
        )
        if not thinking and not btn_disabled:
            turns = page.evaluate("() => document.querySelectorAll('.ct-turn').length")
            print(f"  ✓  Response complete (btn enabled) — {turns} turn(s)")
            shot(page, shots_dir, label)
            return turns

    shot(page, shots_dir, label + "-TIMEOUT")
    raise RuntimeError(f"Timed out waiting for response ({label})")


def follow_up(page, prompt_text, shots_dir, label):
    """Type a follow-up in the conversation reply box and submit."""
    log(f"Follow-up: {prompt_text[:65]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button[type=submit]").click()
    print("  … waiting for follow-up…")
    return wait_for_response(page, shots_dir, label)


# ---------------------------------------------------------------------------
# Agent readiness
# ---------------------------------------------------------------------------

def wait_for_agents_ready(page, shots_dir=None, label="agents-ready", timeout_ms=300_000):
    """
    Poll /api/configure/status until active=false and all ports are 'ready'.
    This is the coordinator's own view of agent server health — more reliable
    than the DOM badges (which freeze) or /api/agents (which returns 200 even
    when servers are still loading).
    """
    import urllib.request, urllib.error, json
    STATUS_URL = "http://localhost:3002/api/configure/status"
    log("Waiting for all agent ports to be ready…")
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        try:
            r = urllib.request.urlopen(STATUS_URL, timeout=4)
            data = json.loads(r.read())
            ports = data.get("ports", {})
            not_ready = [p for p, s in ports.items() if s != "ready"]
            if not data.get("active") and ports and not not_ready:
                print(f"  ✓  All {len(ports)} port(s) ready")
                if shots_dir:
                    shot(page, shots_dir, label)
                return
            print(f"  … {len(not_ready)}/{len(ports)} port(s) not ready yet …")
        except urllib.error.HTTPError as e:
            print(f"  … configure/status {e.code} — deploy still running …")
        except Exception as e:
            print(f"  … configure/status probe failed: {e} …")
        time.sleep(3)
    raise RuntimeError("Timed out waiting for agent ports to become ready")


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
# Video stitching
# ---------------------------------------------------------------------------

def stitch_video(shots_dir, output_mov, frame_secs=2):
    """
    Rename screenshots to sequential 001.png … NNN.png then call ffmpeg
    to produce a ProRes .mov at 1/frame_secs fps.
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
