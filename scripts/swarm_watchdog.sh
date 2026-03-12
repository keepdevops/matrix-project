#!/bin/bash
# MATRIX RESILIENT WATCHDOG v2.0
PORTS=(8080 8081 8082)
CHECK_INTERVAL=5
COOLDOWN=5

echo -e "\033[0;36m[SYSTEM] Watchdog Shield Active. Monitoring: ${PORTS[*]}\033[0m"

while true; do
    for PORT in "${PORTS[@]}"; do
        # Check if Port is active
        if ! lsof -i :$PORT > /dev/null; then
            echo -e "\033[0;31m[ALERT] Agent on $PORT is DOWN.\033[0m"
            echo "  -> Waiting ${COOLDOWN}s for socket clearance..."
            sleep $COOLDOWN
            
            echo "  -> Attempting Relaunch..."
            "$(dirname "$0")/start_swarm.sh" --port $PORT &
            
            # Brief stagger to prevent CPU/RAM spike on M3
            sleep 2
        fi
    done
    sleep $CHECK_INTERVAL
done
