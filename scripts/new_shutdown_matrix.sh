#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/pixi.toml" ]; then
  ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../pixi.toml" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "Error: pixi.toml not found (looked in $SCRIPT_DIR and $SCRIPT_DIR/..)" >&2
  exit 1
fi

echo "========================================"
echo "  MATRIX SWARM SHUTDOWN"
echo "========================================"

cd "$ROOT"

PID_FILE="$ROOT/logs/matrix.pids"

# Stop UI (served by launchd — optionally kill react-scripts if running bare)
echo "[1/4] Stopping UI..."
pkill -f "react-scripts start" 2>/dev/null || true

# Kill tracked PIDs
echo "[2/4] Stopping agents, coordinator, and proxy..."
if [ -f "$PID_FILE" ]; then
    echo "  Killing tracked PIDs..."
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null && echo "    killed $pid"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    echo "  PID file cleared."
fi
pkill -f llama-server       2>/dev/null || true
pkill -f "llama_cpp.server" 2>/dev/null || true
pkill -f "mlx_lm.server"    2>/dev/null || true
pkill -f coordinator        2>/dev/null || true
pkill -f "node proxy.mjs"   2>/dev/null || true

sleep 1

# Force-kill anything still holding the ports
echo "[3/4] Releasing ports..."
lsof -ti:3000,3001,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null || true

# Verify
echo "[4/4] Verifying..."
REMAINING=$(lsof -ti:8000,8080,8081,8082,8083,8084 2>/dev/null)
if [ -z "$REMAINING" ]; then
    echo "  All swarm processes stopped. VRAM released."
else
    echo "  Warning: some processes still running (PIDs: $REMAINING)"
fi

echo "[5/4] Restoring system Auto fan control..."
FAN_SCRIPT="$SCRIPT_DIR/fan_control.sh"
if [ -x "$FAN_SCRIPT" ]; then
    "$FAN_SCRIPT" stop
else
    echo "  (fan_control.sh not found or not executable — skipping)"
fi

echo "========================================"
echo "  SHUTDOWN COMPLETE"
echo "========================================"
