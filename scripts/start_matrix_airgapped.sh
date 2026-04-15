#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LLAMA_SERVER="$PROJECT_DIR/llama.cpp/build/bin/llama-server"
MODELS_DIR="/Users/Shared/llama/models"
LOG_DIR="$PROJECT_DIR/agent_logs"
CONFIG="$SCRIPT_DIR/matrix-config-8agents-flux-hybrid.json"

echo "=== Air-Gapped Swarm Matrix Launcher ==="

mkdir -p "$LOG_DIR"
rm -f "$LOG_DIR"/*.log 2>/dev/null || true

# Verify prerequisites
if [[ ! -x "$LLAMA_SERVER" ]]; then
  echo "❌ llama-server not found at: $LLAMA_SERVER"
  echo "   Build it with: cd $PROJECT_DIR/llama.cpp && cmake -B build && cmake --build build -j"
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "❌ Config not found: $CONFIG"
  exit 1
fi

# 1. Start llama.cpp agents
echo "Starting llama.cpp servers..."
LLAMA_PORTS=(8080 8081 8082 8083)
LLAMA_MODELS=(
  "$MODELS_DIR/phi-4-Q5_K_M.gguf"
  "$MODELS_DIR/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
  "$MODELS_DIR/granite-3.1-8b-instruct-Q4_K_M.gguf"
  "$MODELS_DIR/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
)

for i in "${!LLAMA_PORTS[@]}"; do
  port="${LLAMA_PORTS[$i]}"
  model="${LLAMA_MODELS[$i]}"
  if [[ ! -f "$model" ]]; then
    echo "  ⚠️  Port $port: model not found — $model (skipping)"
    continue
  fi
  echo "  → Port $port: $(basename "$model")"
  "$LLAMA_SERVER" \
    --model "$model" \
    --port "$port" \
    --n-gpu-layers -1 \
    --ctx-size 8192 \
    --parallel 2 \
    --flash-attn on \
    --host 127.0.0.1 \
    --log-file "$LOG_DIR/agent_${port}.log" &
done

# 2. Start MLX agents
echo "Starting MLX agents..."
MLX_VENV=""
if [[ -f "$HOME/.venv-mlx/bin/activate" ]]; then
  MLX_VENV="$HOME/.venv-mlx"
elif [[ -f "$HOME/miniforge3/envs/mlx-env/bin/mlx_lm.server" ]]; then
  MLX_SERVER="$HOME/miniforge3/envs/mlx-env/bin/mlx_lm.server"
fi

run_mlx() {
  local port=$1 model=$2
  if [[ -z "${MLX_SERVER:-}" && -n "$MLX_VENV" ]]; then
    source "$MLX_VENV/bin/activate"
    mlx_lm.server --model "$model" --port "$port" --host 127.0.0.1 &
    deactivate
  elif [[ -n "${MLX_SERVER:-}" ]]; then
    "$MLX_SERVER" --model "$model" --port "$port" --host 127.0.0.1 &
  else
    echo "  ⚠️  Port $port: mlx_lm.server not found (skipping)"
  fi
}

echo "  → Port 8084: Llama-3.2-3B-Instruct-4bit"
run_mlx 8084 "$MODELS_DIR/Llama-3.2-3B-Instruct-4bit"

echo "  → Port 8085: Meta-Llama-3.1-8B-Instruct-4bit"
run_mlx 8085 "$MODELS_DIR/Meta-Llama-3.1-8B-Instruct-4bit"

# 3. vLLM-mlx (optional)
if [[ -f "$HOME/.venv-vllm-mlx/bin/activate" ]]; then
  echo "Starting vLLM-mlx agent..."
  source "$HOME/.venv-vllm-mlx/bin/activate"
  vllm serve "$MODELS_DIR/Meta-Llama-3.1-8B-Instruct-4bit" --port 8000 --host 127.0.0.1 &
  deactivate
else
  echo "ℹ️  vLLM-mlx venv not found — skipping vLLM agents"
fi

echo "Waiting 20s for servers to initialize..."
sleep 20

echo "Launching Coordinator..."
cd "$PROJECT_DIR"
./coordinator --config "$CONFIG"
