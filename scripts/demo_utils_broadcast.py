"""
Broadcast, response-polling, agent-readiness, and video helpers for demo scripts.
Split from demo_utils.py — import from demo_utils for backwards compat.
"""

import os
import subprocess
import sys
import time

from playwright.sync_api import TimeoutError as PWTimeout

from demo_utils import shot, switch_right_tab

RESP_TMO = 600_000   # 10 min per broadcast
POLL_MS  = 1_500


def broadcast(page, prompt_text, prompt_num=None):
    """Fill the prompt textarea and submit."""
    from demo_utils import log
    label = f"#{prompt_num}" if prompt_num else ""
    log(f"Broadcast {label}: {prompt_text[:65]}…")
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
    Poll until the broadcast completes. Returns the current turn count.
    Completion: new completed .ct-turn OR thinking gone + submit re-enabled.
    """
    baseline = page.evaluate(
        "() => document.querySelectorAll('.ct-turn:not(.ct-turn--pending)').length"
    )
    deadline = time.time() + RESP_TMO / 1000
    while time.time() < deadline:
        page.wait_for_timeout(POLL_MS)

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
    from demo_utils import log
    log(f"Follow-up: {prompt_text[:65]}…")
    reply = page.query_selector(".ct-reply-input")
    if not reply:
        raise RuntimeError(".ct-reply-input not found — is there an active session?")
    reply.fill(prompt_text)
    page.query_selector(".ct-reply-form button[type=submit]").click()
    print("  … waiting for follow-up…")
    return wait_for_response(page, shots_dir, label)


def wait_for_agents_ready(page, shots_dir=None, label="agents-ready", timeout_ms=300_000):
    """
    Poll /api/configure/status until active=false and all ports are 'ready'.
    """
    import urllib.request, urllib.error, json
    from demo_utils import log
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
