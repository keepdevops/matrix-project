"""
Agent-readiness polling and video stitching helpers for demo scripts.
Split from demo_utils_broadcast.py — import from demo_utils for backwards compat.
"""

import os
import subprocess
import sys
import time


def wait_for_agents_ready(page, shots_dir=None, label="agents-ready", timeout_ms=300_000):
    """
    Poll /api/configure/status until active=false and all ports are 'ready'.
    """
    import urllib.request, urllib.error, json
    from demo_utils import log, shot
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
    Symlink screenshots to sequential 001.png … NNN.png then call ffmpeg
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
        "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
        output_mov,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ⚠  ffmpeg error:\n{result.stderr[-400:]}", file=sys.stderr)
    else:
        size_mb = os.path.getsize(output_mov) / (1024 * 1024)
        print(f"  🎬  {output_mov}  ({size_mb:.1f} MB)")
