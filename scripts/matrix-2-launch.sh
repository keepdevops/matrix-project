#!/bin/bash
# DEPRECATED: prefer `python3 scripts/matrixctl launch` (native port).
# This script remains for legacy automation but won't receive new features.
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
# Kill any stale proxy on port 3002 so the freshest binary always runs.
STALE_PROXY=$(lsof -ti tcp:3002 2>/dev/null)
if [[ -n "$STALE_PROXY" ]]; then
  echo "  Stopping stale proxy (pid=$STALE_PROXY)..."
  kill "$STALE_PROXY" 2>/dev/null
  sleep 0.5
fi
"$ROOT/proxy" > "$ROOT/logs/proxy.log" 2>&1 &
echo $! >> "$PID_FILE"

for i in {1..10}; do echo -n "."; sleep 0.1; done; echo "."  

# --------------------------------------------------------------
echo "Starting UI"
cd "$ROOT"
# CRA + WDS v5: ensure react-scripts shutdown patch (patch-package may skip start.js
# if webpack hunk already applied — scripts/ensure-react-scripts-patch.mjs falls back).
node "$ROOT/scripts/ensure-react-scripts-patch.mjs" || {
  echo "FATAL: Could not patch react-scripts for webpack-dev-server v5. Run: cd $ROOT && npm install"
  exit 1
}
npm start > logs/ui.log 2>&1 &
echo $! >> "$PID_FILE"

for i in {1..20}; do echo -n "."; sleep 0.1; done; echo "."

# --------------------------------------------------------------
echo "Starting pgvector (RAG backing store)..."
bash "$ROOT/scripts/rag-docker-compose.sh" up
bash "$ROOT/scripts/rag-docker-compose.sh" wait

echo "Starting RAG ingest sidecar..."
RAG_DSN="${RAG_DSN:-postgresql://matrix:matrix@127.0.0.1:5433/matrix_rag}"
RAG_INGEST_EMBEDDER="${RAG_INGEST_EMBEDDER:-mlx}"
cd "$ROOT"
RAG_DSN="$RAG_DSN" python -m orchestration.rag.service \
  --port 8001 \
  --embedder "$RAG_INGEST_EMBEDDER" \
  > "$ROOT/logs/rag_ingest.log" 2>&1 &
echo $! >> "$PID_FILE"
for i in {1..15}; do
  if curl -sf http://localhost:8001/health > /dev/null 2>&1; then
    echo " RAG sidecar ready."
    break
  fi
  echo -n "."; sleep 0.5
done

echo "SWARM MATRIX started -> localhost:3000"
echo "=========================================================="

# EOF
