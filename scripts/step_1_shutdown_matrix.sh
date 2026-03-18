#!/bin/bash

echo "========================================"
echo "$0"
echo "  MATRIX SWARM SHUTDOWN ALL"
echo "========================================"
echo " run with sudo $0"
echo "========================================"



# Stop UI
echo " Stopping processes..."
cd "$(dirname "$0")/.."

pkill -f "react-scripts start" 
echo "-1--------------------------------------"

docker-compose down 
sleep 2
docker-compose down --remove-orphans
sleep 2

docker ps -a
docker stop matrix-proxy
docker stop matrix-ui
docker rm   matrix-proxy
docker rm   matrix-ui
echo "-2--------------------------------------"

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
lsof -ti:3000,3001,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 

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
docker ps -a




echo "========================================"
echo "  SHUTDOWN COMPLETE"
echo "========================================"
echo "Next... close Firefox"
