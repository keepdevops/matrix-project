#!/bin/bash
# Quick start: kills existing backend processes and restarts the proxy.
# The UI is served automatically by launchd (com.caribou.swarm-dashboard) at port 3000.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT/logs/matrix.pids"

cd "$ROOT"

echo "[1/2] Stopping existing backend processes..."
if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi
pkill -f llama-server            2>/dev/null
pkill -f coordinator             2>/dev/null
pkill -f "node proxy.mjs"        2>/dev/null
PIDS=$(lsof -ti:3002,8000,8080,8081,8082,8083,8084 2>/dev/null)
[ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null
sleep 3

echo "[2/2] Starting proxy on port 3002..."
mkdir -p "$ROOT/logs"
node proxy.mjs > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"

sleep 2
echo "========================================"
echo "  UI:     http://localhost:3000"
echo "  Proxy:  http://localhost:3002"
echo "  Open the UI, click CONFIGURE, then"
echo "  click LAUNCH SWARM to start agents."
echo "========================================"
