#!/bin/bash

# 1. ARCHITECT (Llama 3.1 8B) - Port 8080
/Users/Shared/models/llama-server -m /Users/Shared/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf -c 4096 --port 8080 --n-gpu-layers 81 > agent_8080.log 2>&1 &
echo "🚀 Architect (8B) starting on 8080..."

# 2. LOGIC (Llama 3.2 3B) - Port 8081
/Users/Shared/models/llama-server -m /Users/Shared/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf -c 4096 --port 8081 --n-gpu-layers 81 > agent_8081.log 2>&1 &
echo "🚀 Logic (3B) starting on 8081..."

# 3. UTILITY (Granite 3.1 8B) - Port 8082
/Users/Shared/models/llama-server -m /Users/Shared/models/granite-3.1-8b-instruct-Q4_K_M.gguf -c 4096 --port 8082 --n-gpu-layers 81 > agent_8082.log 2>&1 &
echo "🚀 Utility (Granite-3.1) starting on 8082..."

echo "--- SWARM DEPLOYED ---"
