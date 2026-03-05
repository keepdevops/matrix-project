#!/bin/bash

# 1. Kill any existing servers to clear the ports
echo "🧹 Cleaning up existing processes..."
lsof -ti:8080,8081,8082 | xargs kill -9 2>/dev/null

# 2. Launch the Swarm
echo "🚀 Launching Matrix Swarm on M3 Max..."

# Agent 8080 (Llama 8B)
/Users/Shared/models/llama-server -m /Users/Shared/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf --port 8080 --ctx-size 4096 --threads 10 &
echo "✅ Port 8080: Llama-3.1-8B starting..."

# Agent 8081 (Llama 3B)
/Users/Shared/models/llama-server -m /Users/Shared/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf --port 8081 --ctx-size 2048 --threads 10 &
echo "✅ Port 8081: Llama-3.2-3B starting..."

# Agent 8082 (Granite 8B)
/Users/Shared/models/llama-server -m /Users/Shared/models/granite-3.1-8b-instruct-Q4_K_M.gguf --port 8082 --ctx-size 2048 --threads 10 &
echo "✅ Port 8082: Granite-3.1-8B starting..."

echo "🌟 All agents are initializing. Use 'lsof -iTCP -sTCP:LISTEN' to monitor."
