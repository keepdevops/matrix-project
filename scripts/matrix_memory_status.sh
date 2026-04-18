#!/bin/bash

# Define colors for the terminal UI
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}--- MATRIX SWARM REAL-TIME STATUS ---${NC}"
printf "%-10s %-10s %-12s %-20s\n" "PID" "PORT" "RAM (MB)" "MODEL PATH"
echo "------------------------------------------------------------"

# Find all running llama-server processes
pgrep -f "llama-server" | while read -r pid; do
    # Get RAM usage in KB and convert to MB
    rss_kb=$(ps -p "$pid" -o rss= | tr -d ' ')
    ram_mb=$((rss_kb / 1024))
    
    # Extract the port and model path from the process command line
    cmd_line=$(ps -p "$pid" -o command=)
    port=$(echo "$cmd_line" | grep -oE "\-\-port [0-9]+" | awk '{print $2}')
    model=$(echo "$cmd_line" | grep -oE "models/[^ ]+")

    # Format output
    printf "${BLUE}%-10s${NC} %-10s ${GREEN}%-12s${NC} %-20s\n" "$pid" "$port" "$ram_mb" "$model"
done

echo "------------------------------------------------------------"
# Show total system memory pressure summary
memory_pressure=$(memory_pressure | grep "System-wide memory free percentage" | awk '{print $5}')
echo -e "System Memory Free: ${BOLD}${memory_pressure}${NC}"
