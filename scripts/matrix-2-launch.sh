#!/bin/bash
echo "=========================================================="
echo "SWARM MATRIX starting"
echo "${BASH_SOURCE[0]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "Working directory = ${ROOT}" 
mkdir -p "$ROOT/logs"


# overlay matrix-env.sh , may include conda, etc.
# possible shellcheck disable=SC1091
if [[ -f "$ROOT/scripts/matrix-env.sh" ]]; then
  source "$ROOT/scripts/matrix-env.sh"
fi


: '
echo "[1/3] Activating GPU fan control (28–36°C sensor-based)..."
FAN_SCRIPT="$ROOT/scripts/fan_control.sh"
if [ -x "$FAN_SCRIPT" ]; then
    "$FAN_SCRIPT" start
else
    echo "  (fan_control.sh not found or not executable — skipping)"
fi
'

mkdir -p "$HOME/.matrix/run" "$HOME/.matrix/slots"

# --------------------------------------------------------------
echo "Starting Proxy..."
PID_FILE="$ROOT/logs/matrix.pids"
# Following command clears stale PID file from any previous run
> "$PID_FILE"
"$ROOT/proxy" > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"

for i in {1..10}; do echo -n "."; sleep 0.1; done; echo "."  

# --------------------------------------------------------------
echo "Starting UI"
cd "$ROOT"
npm start > logs/ui.log 2>&1 &
echo $! >> "$PID_FILE"

for i in {1..20}; do echo -n "."; sleep 0.1; done; echo "."  

echo "SWARM MATRIX started -> localhost:3000"
echo "=========================================================="

# EOF
