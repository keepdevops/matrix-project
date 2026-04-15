#!/bin/bash
# Launch 4 docker-vllm inference servers for the swarm.
# Usage: ./scripts/start_vllm_servers.sh [--wait]
#   --wait  Block until all 4 servers pass /v1/models health check (up to 10 min).

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/agent_logs"
mkdir -p "$LOGS"

WAIT=false
for arg in "$@"; do [[ "$arg" == "--wait" ]] && WAIT=true; done

echo "========================================"
echo "  Starting docker-vllm inference servers"
echo "========================================"

# Kill any prior docker model run processes occupying 8080-8083
lsof -ti:8080,8081,8082,8083 | xargs kill -9 2>/dev/null || true
pkill -f 'docker model run' 2>/dev/null || true
sleep 2

echo "[1/4] Port 8080 — Qwen2.5-14B-Instruct (reasoning, ctx=8192, gpu_mem=0.85)"
docker model run Qwen/Qwen2.5-14B-Instruct \
  --backend vllm \
  --port 8080 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192 \
  --tensor-parallel-size 1 \
  > "$LOGS/8080.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8080.log"

echo "[2/4] Port 8081 — Llama-3.2-3B-Instruct (fast general, ctx=4096, gpu_mem=0.75)"
docker model run meta-llama/Llama-3.2-3B-Instruct \
  --backend vllm \
  --port 8081 \
  --gpu-memory-utilization 0.75 \
  --max-model-len 4096 \
  > "$LOGS/8081.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8081.log"

echo "[3/4] Port 8082 — DeepSeek-Coder-V2-Lite-Instruct (coding, ctx=4096, gpu_mem=0.80)"
docker model run deepseek-ai/DeepSeek-Coder-V2-Lite-Instruct \
  --backend vllm \
  --port 8082 \
  --gpu-memory-utilization 0.80 \
  --max-model-len 4096 \
  > "$LOGS/8082.log" 2>&1 &
echo "  PID $! — logs: $LOGS/8082.log"

echo "[4/4] Port 8083 — Phi-4-mini-instruct (research, ctx=4096, gpu_mem=0.70)"
docker model run microsoft/Phi-4-mini-instruct \
  --backend vllm \
  --port 8083 \
  --gpu-memory-utilization 0.70 \
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
