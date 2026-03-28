#!/bin/bash
# MATRIX RESILIENT WATCHDOG v3.0
PORTS=(8080 8081 8082 8083)
CHECK_INTERVAL=10
COOLDOWN=5
ACTIVE_CONFIG=/tmp/matrix-active-config.json
PROXY_URL="http://localhost:3002/api/configure"

echo -e "\033[0;36m[SYSTEM] Watchdog Shield Active. Monitoring: ${PORTS[*]}\033[0m"

restart_swarm() {
    local trigger_port=$1
    echo -e "\033[0;33m  -> Port $trigger_port is DOWN. Triggering full swarm restart via proxy...\033[0m"
    if [ ! -f "$ACTIVE_CONFIG" ]; then
        echo -e "\033[0;31m  -> ERROR: No active config at $ACTIVE_CONFIG — launch swarm from UI first.\033[0m"
        return
    fi
    local agents
    agents=$(python3 -c "import json,sys; d=json.load(open('$ACTIVE_CONFIG')); print(json.dumps({'agents': d['agents']}))" 2>/dev/null)
    if [ -z "$agents" ]; then
        echo -e "\033[0;31m  -> ERROR: Could not parse $ACTIVE_CONFIG\033[0m"
        return
    fi
    curl -s -X POST "$PROXY_URL" \
        -H "Content-Type: application/json" \
        -d "$agents" \
        --max-time 300 \
        -o /tmp/watchdog_restart.json &
    echo "  -> Restart triggered (models may take 1-4 min to load)"
}

RESTARTING=0
while true; do
    if [ $RESTARTING -eq 0 ]; then
        for PORT in "${PORTS[@]}"; do
            if ! curl -sf "http://127.0.0.1:$PORT/health" > /dev/null 2>&1; then
                echo -e "\033[0;31m[ALERT] Agent on $PORT is DOWN.\033[0m"
                echo "  -> Waiting ${COOLDOWN}s for socket clearance..."
                sleep $COOLDOWN
                restart_swarm $PORT
                RESTARTING=1
                break
            fi
        done
    fi
    sleep $CHECK_INTERVAL
    RESTARTING=0
done
