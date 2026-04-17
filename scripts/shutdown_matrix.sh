#!/bin/bash

BAREMETAL=false

if [[ "$1" == "baremetal" ]] || [[ "$1" == "--baremetal" ]]; then
    BAREMETAL=true
fi

echo "========================================"
echo "$0"
if [ "$BAREMETAL" = true ]; then
    echo "  SWARM MATRIX SHUTDOWN (BAREMETAL)"
else
    echo "  SWARM MATRIX SHUTDOWN ALL"
fi
echo "========================================"
echo " run with sudo $0 [baremetal]"
echo "========================================"



# Stop UI
echo " Stopping processes..."
cd "$(dirname "$0")/.."

pkill -f "react-scripts start" || true
echo "-1--------------------------------------"

# Stop production docker-compose (if running)
if [ "$BAREMETAL" = false ]; then
    echo " Stopping production docker-compose..."
    docker compose -f production/docker-compose.prod.yml down 2>/dev/null || true
    sleep 1
    docker compose -f production/docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
    sleep 1
    echo "-0.5--------------------------------------"

    docker-compose down 2>/dev/null || true
    sleep 2
    docker-compose down --remove-orphans 2>/dev/null || true
    sleep 2

    docker ps -a 2>/dev/null || true
    docker stop matrix-proxy swarm-matrix-ui production-swarm-ui matrix-ui 2>/dev/null || true
    docker rm   matrix-proxy swarm-matrix-ui production-swarm-ui matrix-ui 2>/dev/null || true
    echo "-2--------------------------------------"
else
    echo " (Skipping Docker operations - baremetal mode)"
    echo "-2--------------------------------------"
fi

PID_FILE="$(dirname "$0")/../logs/matrix.pids"

# Kill tracked PIDs
echo " Stopping agents, coordinator, and proxy..."
if [ -f "$PID_FILE" ]; then
    echo "  Killing tracked PIDs..."
    while IFS= read -r pid; do
        kill "$pid"  && echo "    killed $pid"
    done < "$PID_FILE"
    rm -f  "$PID_FILE"
    echo "   PID file cleared."
fi

# C++ HTTP proxy (launch_matrix runs "$ROOT/proxy"; may be missing from PID file)
ROOT_ABS="$(cd "$(dirname "$0")/.." && pwd)"
echo "-3a--------------------------------------"
echo " Stopping C++ proxy (${ROOT_ABS}/proxy)..."
if [[ -x "${ROOT_ABS}/proxy" ]]; then
    pkill -f "${ROOT_ABS}/proxy" 2>/dev/null && echo "    stopped ${ROOT_ABS}/proxy" || true
fi

echo "-3--------------------------------------"
pkill -f llama-server 

echo "-4--------------------------------------"
pkill -f "llama_cpp.server" 

echo "-5--------------------------------------"
pkill -f "mlx_lm.server" 

echo "-6--------------------------------------"
pkill -f coordinator 

echo "-7--------------------------------------"
pkill -f "node proxy.mjs" 

sleep 1

echo "-8--------------------------------------"
echo " Releasing ports..."
echo "pkill <ports>--------------------------"
lsof -ti:3000,3001,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null || true

echo "-9--------------------------------------"
echo " Verifying..."
REMAINING=$(lsof -ti:8000,8080,8081,8082,8083,8084 )
if [ -z "$REMAINING" ]; then
    echo "-9.1----------------------"
    echo "  All swarm processes stopped. VRAM released."
else
    echo "-9.2----------------------"
    echo "  Warning: some processes still running (PIDs: $REMAINING)"
fi

echo "-10--------------------------------------"
echo "stop fan--------------------------"
echo " Restoring system Auto fan control..."
FAN_SCRIPT="$(dirname "$0")/fan_control.sh"
if [ -x "$FAN_SCRIPT" ]; then
    "$FAN_SCRIPT" stop
else
    echo "  (fan_control.sh not found or not executable — skipping)"
fi

echo "-11--------------------------------------"


ps -ef | grep -v grep | grep llama
ps -ef | grep -v grep | grep coordinator
ps -ef | grep -v grep | grep npm
if [ "$BAREMETAL" = false ]; then
    docker ps -a
fi




echo "========================================"
echo "  SHUTDOWN COMPLETE"
echo "========================================"
echo "Next... close Firefox"
