#!/usr/bin/env bash
# Stop everything started by up.sh.
# Run from anywhere: bash scripts/down.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/logs/matrix.pids"

echo "[down] Stopping Matrix..."

# kill tracked PIDs
if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
        kill "$pid" 2>/dev/null && echo "  killed $pid" || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# catch anything that slipped through
pkill -f "${ROOT}/proxy"          2>/dev/null || true
pkill -f "react-scripts start"    2>/dev/null || true

# release ports
lsof -ti:3000,3002,8000,8080,8081,8082,8083,8084 | xargs kill -9 2>/dev/null || true

echo "[down] Done."
