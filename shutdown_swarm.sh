#!/bin/bash

echo "--- MATRIX SWARM DECOMMISSION ---"

# 1. Kill the Agents first
echo "Stopping all llama-server agents..."
# -f matches the full command line to be specific to our GGUF models
pkill -f "llama-server" 

# 2. Kill the Proxy
echo "Stopping Matrix Proxy..."
pkill -f "node proxy.mjs"

# 3. Cleanup temporary files
if [ -f "proxy.log" ]; then
    echo "Archiving session logs..."
    mv proxy.log last_session.log
fi

# 4. Verification
echo "Verifying VRAM release..."
sleep 1
STILL_RUNNING=$(pgrep -f "llama-server")

if [ -z "$STILL_RUNNING" ]; then
    echo "✓ All agents terminated. VRAM cleared."
else
    echo "⚠ Warning: Some agents are still hanging. Force killing..."
    pkill -9 -f "llama-server"
fi

echo "--- SHUTDOWN COMPLETE ---"
