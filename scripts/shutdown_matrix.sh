#!/bin/bash

echo "========================================"
echo "  MATRIX SWARM SHUTDOWN"
echo "========================================"
echo "  1) Docker"
echo "  2) Bare Metal"
echo "========================================"
read -rp "Select mode [1/2]: " MODE

if [ "$MODE" = "2" ]; then
    NO_DOCKER=true
else
    NO_DOCKER=false
fi
echo

# Stop UI
echo "[1/4] Stopping UI..."
cd "$(dirname "$0")/.."
if $NO_DOCKER; then
    pkill -f "react-scripts start" 2>/dev/null
else
    docker-compose down 2>/dev/null
fi

PID_FILE="$(dirname "$0")/../logs/matrix.pids"

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
pkill -f llama-server 2>/dev/null
pkill -f "llama_cpp.server" 2>/dev/null
pkill -f "mlx_lm.server" 2>/dev/null
pkill -f coordinator 2>/dev/null
pkill -f "node proxy.mjs" 2>/dev/null

sleep 1

# Force-kill anything still holding the ports
echo "[3/4] Releasing ports..."
lsof -ti:3000,3001,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null

# Verify
echo "[4/5] Verifying..."
REMAINING=$(lsof -ti:8000,8080,8081,8082,8083,8084 2>/dev/null)
if [ -z "$REMAINING" ]; then
    echo "  All swarm processes stopped. VRAM released."
else
    echo "  Warning: some processes still running (PIDs: $REMAINING)"
fi

echo "[5/5] Restoring system Auto fan control..."
"$(dirname "$0")/fan_control.sh" stop

echo "========================================"
echo "  SHUTDOWN COMPLETE"
echo "========================================"
