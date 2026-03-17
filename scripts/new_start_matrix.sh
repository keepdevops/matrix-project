#!/bin/bash
# Start the Matrix Swarm using pixi: builds coordinator, then starts the backend proxy.

set -e
echo "[1/4] Stopping existing backend processes..."
if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi
pkill -f llama-server            2>/dev/null || true
pkill -f coordinator             2>/dev/null || true
pkill -f "node proxy.mjs"        2>/dev/null || true
PIDS=$(lsof -ti:3002,8000,8080,8081,8082,8083,8084 2>/dev/null)
[ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/pixi.toml" ]; then
  ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../pixi.toml" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "Error: pixi.toml not found (looked in $SCRIPT_DIR and $SCRIPT_DIR/..)" >&2
  exit 1
fi

MANIFEST="$ROOT/pixi.toml"
PID_FILE="$ROOT/logs/matrix.pids"

cd "$ROOT"

if ! command -v pixi >/dev/null 2>&1; then
  echo "Error: pixi not found. Install from https://pixi.sh" >&2
  exit 1
fi

echo "[2/44] Installing pixi environment..."
pixi install --manifest-path "$MANIFEST"

echo "[3/4] Building coordinator..."
pixi run --manifest-path "$MANIFEST" build-coordinator

sleep 3

echo "[4/4] Starting proxy on port 3002..."
mkdir -p "$ROOT/logs"
pixi run --manifest-path "$MANIFEST" node proxy.mjs > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"

sleep 2
echo "========================================"
echo "  UI:     http://localhost:3000"
echo "  Proxy:  http://localhost:3002"
echo "  Open the UI, click CONFIGURE, then"
echo "  click LAUNCH SWARM to start agents."
echo "========================================"
