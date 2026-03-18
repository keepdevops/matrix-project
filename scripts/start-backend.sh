#!/bin/bash
# Quick start: kills existing backend processes and restarts the proxy.
# The UI is served automatically by launchd (com.caribou.swarm-dashboard) at port 3000.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT/logs/matrix.pids"

cd "$ROOT"


echo "[2/2] Starting proxy on port 3002..."
mkdir -p "$ROOT/logs"
node proxy.mjs > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"

sleep 2
echo "========================================"
echo "  UI:     http://localhost:3000"
echo "  Proxy:  http://localhost:3002"
echo "========================================"
echo "  Open the UI, click CONFIGURE, then"
echo "  click LAUNCH SWARM to start agents."
echo "========================================"
