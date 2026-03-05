#!/bin/bash

echo "========================================"
echo "  MATRIX SWARM LAUNCH SEQUENCE"
echo "========================================"

# Stop any existing services
echo "[1/5] Cleaning up existing processes..."
pkill -f llama-server 2>/dev/null
pkill -f coordinator 2>/dev/null
pkill -f "node proxy.mjs" 2>/dev/null
# Specifically kill the ports to avoid "Address already in use"
lsof -ti:3000,3001,3002,8000,8080,8081,8082 | xargs kill -9 2>/dev/null
docker-compose down 2>/dev/null

sleep 2

# Start the LLM swarm agents
echo "[2/5] Starting LLM Swarm Agents..."
cd "$(dirname "$0")"

/Users/Shared/models/llama-server -m /Users/Shared/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf -c 4096 --port 8080 --n-gpu-layers 81 > logs/8080.log 2>&1 &
/Users/Shared/models/llama-server -m /Users/Shared/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf -c 4096 --port 8081 --n-gpu-layers 81 > logs/8081.log 2>&1 &
/Users/Shared/models/llama-server -m /Users/Shared/models/granite-3.1-8b-instruct-Q4_K_M.gguf -c 4096 --port 8082 --n-gpu-layers 81 > logs/8082.log 2>&1 &

echo "    -> Agents Initializing..."
sleep 5 # Give them a moment to bind ports

# Start Coordinator
echo "[3/5] Starting Coordinator on port 8000..."
./coordinator > logs/coordinator.log 2>&1 &

# Start Node Proxy (Crucial for UI connectivity)
echo "[4/5] Starting Node Proxy on port 3002..."
node proxy.mjs > logs/proxy.log 2>&1 &

# Start Docker
echo "[5/5] Starting Docker Compose (UI)..."
docker-compose up -d

echo "========================================"
echo "  MATRIX SYSTEM ONLINE"
echo "========================================"
echo "  Access UI:        http://localhost:3000"
echo "  Proxy Bridge:     http://localhost:3002"
echo "========================================"
