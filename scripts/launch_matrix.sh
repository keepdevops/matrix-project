#!/bin/bash

echo "========================================"
echo "  MATRIX SWARM LAUNCH SEQUENCE"
echo "========================================"
echo "  1) Docker  (UI in container)"
echo "  2) Bare Metal  (UI via npm start)"
echo "========================================"
read -rp "Select mode [1/2]: " MODE

if [ "$MODE" = "2" ]; then
    NO_DOCKER=true
    echo "  Mode: Bare Metal"
else
    NO_DOCKER=false
    echo "  Mode: Docker"
fi
echo

PID_FILE="$(dirname "$0")/../logs/matrix.pids"

echo "[1/3] Cleaning up existing processes..."
cd "$(dirname "$0")/.."
# Kill previously tracked PIDs
if [ -f "$PID_FILE" ]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi
if ! $NO_DOCKER; then
    docker-compose down --remove-orphans 2>/dev/null
    sleep 3
fi
pkill -f llama-server 2>/dev/null
pkill -f coordinator 2>/dev/null
pkill -f "node proxy.mjs" 2>/dev/null
pkill -f "react-scripts start" 2>/dev/null
lsof -ti:3000,3001,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null
sleep 5

echo "[1.5/3] Activating GPU fan control (28–36°C sensor-based)..."
"$(dirname "$0")/fan_control.sh" start

echo "[2/3] Starting Node Proxy on port 3002..."
mkdir -p logs
node proxy.mjs > logs/proxy.log 2>&1 &
echo $! >> "$PID_FILE"
sleep 2

echo "[3/3] Starting UI..."
if $NO_DOCKER; then
    npm start > logs/ui.log 2>&1 &
    echo $! >> "$PID_FILE"
    echo "    -> React dev server starting (bare metal)..."
else
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 2
    docker-compose up -d
fi

echo "========================================"
echo "  MATRIX PROXY ONLINE"
if $NO_DOCKER; then echo "  Mode: Bare Metal"; fi
echo "========================================"
echo "  Open:   http://localhost:3000"
echo "  Select agents and models in the UI,"
echo "  then click LAUNCH SWARM to start."
echo "========================================"
