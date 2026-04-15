#!/usr/bin/env bash
# Bring up Matrix: build binaries, start proxy (backend), start React UI.
# Run from anywhere: bash scripts/up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ── env defaults ──────────────────────────────────────────────────────────────
source "$ROOT/scripts/matrix-env.sh"

LOGS="$ROOT/logs"
PID_FILE="$LOGS/matrix.pids"
mkdir -p "$LOGS"
> "$PID_FILE"   # clear stale PIDs

# ── 1. build ──────────────────────────────────────────────────────────────────
echo "[1/3] Building binaries..."
bash "$ROOT/scripts/build.sh"

# ── 2. proxy (C++ backend on :3002) ───────────────────────────────────────────
echo "[2/3] Starting proxy on :${MATRIX_PROXY_PORT}..."
"$ROOT/proxy" > "$LOGS/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"
sleep 1

# quick health-check
if ! lsof -ti:"${MATRIX_PROXY_PORT}" >/dev/null 2>&1; then
    echo "  [error] proxy did not bind to :${MATRIX_PROXY_PORT} — check $LOGS/proxy.log"
    exit 1
fi
echo "  -> proxy running (PID $(tail -1 "$PID_FILE"))"

# ── 3. React UI ───────────────────────────────────────────────────────────────
echo "[3/3] Starting React UI on :3000..."
npm start > "$LOGS/ui.log" 2>&1 &
echo $! >> "$PID_FILE"

echo ""
echo "  Matrix is up."
echo "  UI:    http://localhost:3000"
echo "  Proxy: http://localhost:${MATRIX_PROXY_PORT}"
echo "  Logs:  $LOGS/"
echo "  PIDs:  $PID_FILE"
echo ""
echo "  Stop with: bash scripts/down.sh"
