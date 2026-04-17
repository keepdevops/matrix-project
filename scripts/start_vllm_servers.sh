#!/bin/bash
# Launch 4 docker-vllm inference servers for the swarm.
# GPU memory is auto-scaled based on system RAM to avoid OOM.
# Usage: ./scripts/start_vllm_servers.sh [--wait]
#   --wait  Block until all 4 servers pass /v1/models health check (up to 10 min).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/agent_logs"
mkdir -p "$LOGS"

WAIT=false
for arg in "$@"; do [[ "$arg" == "--wait" ]] && WAIT=true; done

# ── Detect total system memory ─────────────────────────────────────────────────
OS="$(uname -s)"
TOTAL_GB=0
if [[ "$OS" == "Darwin" ]]; then
  TOTAL_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
elif [[ -f /proc/meminfo ]]; then
  TOTAL_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1048576 ))
fi

if (( TOTAL_GB == 0 )); then
  echo "Warning: Could not detect system memory, using conservative defaults"
  TOTAL_GB=32
fi

# ── Scale GPU memory utilization based on total available ─────────────────────
# Target: each model gets a fraction of (TOTAL_GB - 3GB reserved for system/overhead)
# Allocation ratios: 14B:3B:Coder:Phi = 12:4:6:5 (proportional to model size)
AVAILABLE_GB=$(( TOTAL_GB - 3 ))
TOTAL_RATIO=$((12 + 4 + 6 + 5))

GB_8080=$(( (AVAILABLE_GB * 12) / TOTAL_RATIO ))
GB_8081=$(( (AVAILABLE_GB * 4) / TOTAL_RATIO ))
GB_8082=$(( (AVAILABLE_GB * 6) / TOTAL_RATIO ))
GB_8083=$(( (AVAILABLE_GB * 5) / TOTAL_RATIO ))

MEM_8080=$(awk "BEGIN {printf \"%.2f\", $GB_8080 / $TOTAL_GB}")
MEM_8081=$(awk "BEGIN {printf \"%.2f\", $GB_8081 / $TOTAL_GB}")
MEM_8082=$(awk "BEGIN {printf \"%.2f\", $GB_8082 / $TOTAL_GB}")
MEM_8083=$(awk "BEGIN {printf \"%.2f\", $GB_8083 / $TOTAL_GB}")

echo "========================================"
echo "  Starting docker-vllm inference servers"
echo "  System RAM: ${TOTAL_GB}GB | Available: ${AVAILABLE_GB}GB"
echo "========================================"

# Kill any prior docker model run processes occupying 8080-8083
lsof -ti:8080,8081,8082,8083 | xargs kill -9 2>/dev/null || true
pkill -f 'docker model run' 2>/dev/null || true
sleep 2

echo "[1/4] Port 8080 — Qwen2.5-14B-Instruct (reasoning, ctx=8192, gpu_mem=${GB_8080}GB/${MEM_8080})"
docker model run Qwen/Qwen2.5-14B-Instruct \
  --backend vllm \
  --port 8080 \
  --gpu-memory-utilization "$MEM_8080" \
  --max-model-len 8192 \
  --tensor-parallel-size 1 \
  > "$LOGS/8080.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8080.log"

echo "[2/4] Port 8081 — Llama-3.2-3B-Instruct (fast general, ctx=4096, gpu_mem=${GB_8081}GB/${MEM_8081})"
docker model run meta-llama/Llama-3.2-3B-Instruct \
  --backend vllm \
  --port 8081 \
  --gpu-memory-utilization "$MEM_8081" \
  --max-model-len 4096 \
  > "$LOGS/8081.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8081.log"

echo "[3/4] Port 8082 — DeepSeek-Coder-V2-Lite-Instruct (coding, ctx=4096, gpu_mem=${GB_8082}GB/${MEM_8082})"
docker model run deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct \
  --backend vllm \
  --port 8082 \
  --gpu-memory-utilization "$MEM_8082" \
  --max-model-len 4096 \
  > "$LOGS/8082.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8082.log"

echo "[4/4] Port 8083 — Phi-4-mini-instruct (research, ctx=4096, gpu_mem=${GB_8083}GB/${MEM_8083})"
docker model run microsoft/Phi-4-mini-instruct \
  --backend vllm \
  --port 8083 \
  --gpu-memory-utilization "$MEM_8083" \
  --max-model-len 4096 \
  > "$LOGS/8083.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8083.log"

echo
echo "All 4 servers launched in background."

if ! $WAIT; then
  echo "Run with --wait to block until all servers are healthy."
  echo "Or monitor individually: tail -f $LOGS/<port>.log"
  exit 0
fi

echo
echo "Waiting for /v1/models health check on all ports (timeout: 600s)..."
PORTS=(8080 8081 8082 8083)
DEADLINE=$(( $(date +%s) + 600 ))

while true; do
  FAILED=()
  for PORT in "${PORTS[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      --connect-timeout 3 --max-time 10 \
      "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null || echo "000")
    [[ "$STATUS" != "200" ]] && FAILED+=("$PORT")
  done

  if [[ ${#FAILED[@]} -eq 0 ]]; then
    echo "========================================"
    echo "  All vLLM servers healthy!"
    echo "  Ports: 8080 8081 8082 8083"
    echo "========================================"
    exit 0
  fi

  NOW=$(date +%s)
  if [[ $NOW -ge $DEADLINE ]]; then
    echo "ERROR: Timeout — ports still not ready: ${FAILED[*]}"
    for P in "${FAILED[@]}"; do
      echo "--- Last lines from $LOGS/${P}.log ---"
      tail -5 "$LOGS/${P}.log" 2>/dev/null || echo "(no log)"
    done
    exit 1
  fi

  REMAINING=$(( DEADLINE - NOW ))
  echo "  Still waiting on ports: ${FAILED[*]} (${REMAINING}s left)"
  sleep 5
done
