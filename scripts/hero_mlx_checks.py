"""Preflight checks and teardown helpers for hero_mlx.py."""

import os
import subprocess
import sys
import urllib.request


def check_dev_server(url="http://localhost:3000"):
    try:
        urllib.request.urlopen(url, timeout=5)
    except Exception:
        print(f"❌  Dev server not reachable at {url}", file=sys.stderr)
        print("    Run: npm start", file=sys.stderr)
        sys.exit(1)


def check_mlx_coordinator(url="http://localhost:3002/api/mlx/health"):
    try:
        urllib.request.urlopen(url, timeout=3)
    except Exception:
        print(f"❌  C++ MLX coordinator not reachable at {url}", file=sys.stderr)
        print("    Run: brewctl launch  (starts proxy on :3002)", file=sys.stderr)
        sys.exit(1)


def open_videos(videos):
    """Open produced video files and print a summary."""
    print(f"\nProduced {len(videos)} video(s):\n")
    for v in videos:
        size = os.path.getsize(v) / (1024 * 1024) if os.path.exists(v) else 0
        print(f"  🎬  {v}  ({size:.1f} MB)")
    if videos:
        subprocess.run(["open"] + [v for v in videos if os.path.exists(v)])
