#!/bin/bash

echo "========================================"
echo "launch_matrix.sh"
echo "========================================"
echo "  SWARM MATRIX LAUNCH SEQUENCE"
echo "========================================"
echo "  1) Docker  (UI in container)"
echo "  2) Bare Metal  (UI via npm start)"
echo "========================================"
# Non-interactive: MATRIX_LAUNCH_MODE=1 (Docker) or 2 (bare metal)
if [ -n "${MATRIX_LAUNCH_MODE:-}" ]; then
    MODE="${MATRIX_LAUNCH_MODE}"
    echo "  Using MATRIX_LAUNCH_MODE=${MODE}"
else
    read -rp "Select mode [1/2]: " MODE
fi

if [ "$MODE" = "2" ]; then
    NO_DOCKER=true
    echo "  Mode: Bare Metal"
else
    NO_DOCKER=false
    echo "  Mode: Docker"
fi
echo

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$ROOT/logs/matrix.pids"

# Load MATRIX_* defaults (override by exporting before launch or in ~/.profile)
if [[ -f "$ROOT/scripts/matrix-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/matrix-env.sh"
fi


#---------------------------------------------
#echo "[1/3] Cleaning up docker processes..."
#if ! $NO_DOCKER; then
#    docker-compose down --remove-orphans 
#    sleep 3
#fi
#---------------------------------------------


echo "[2/3] Activating GPU fan control (28–36°C sensor-based)..."
FAN_SCRIPT="$ROOT/scripts/fan_control.sh"
if [ -x "$FAN_SCRIPT" ]; then
    "$FAN_SCRIPT" start
else
    echo "  (fan_control.sh not found or not executable — skipping)"
fi

echo "[2/3] Starting C++ Proxy on port 3002..."
mkdir -p "$ROOT/logs"
"$ROOT/proxy" > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"
sleep 2

echo "[3/3] Starting UI..."
cd "$ROOT"
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
