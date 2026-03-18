#!/bin/bash

echo "========================================"
echo "launch_matrix.sh"
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


#---------------------------------------------
#echo "[1/3] Cleaning up docker processes..."
#if ! $NO_DOCKER; then
#    docker-compose down --remove-orphans 
#    sleep 3
#fi
#---------------------------------------------


echo "[2/3] Activating GPU fan control (28–36°C sensor-based)..."
FAN_SCRIPT="$(dirname "$0")/fan_control.sh"
if [ -x "$FAN_SCRIPT" ]; then
    "$FAN_SCRIPT" start
else
    echo "  (fan_control.sh not found or not executable — skipping)"
fi

echo "[2/3] Starting Node Proxy on port 3002..."
mkdir -p logs
node proxy.mjs > logs/proxy.log  &
echo $! >> "$PID_FILE"
sleep 2

echo "[3/3] Starting UI..."
if $NO_DOCKER; then
    npm start > logs/ui.log  &
    echo $! >> "$PID_FILE"
    echo "    -> React dev server starting (bare metal)..."
else
    ### lsof -ti:3000 | xargs kill -9 
    sleep 2
    echo "===== docker-compose up ====="
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
