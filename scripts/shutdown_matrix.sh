#!/bin/bash

# Function to kill process(es) and verify
kill_process_on_port() {
  local port=$1
  local service_name=$2

  echo "Stopping $service_name on :$port"

  pids=$(lsof -ti :$port 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ No process running on port $port"
    return 0
  fi


  echo "  Sending SIGTERM to PID(s): $pids"
  kill $pids 2>/dev/null
  for i in {1..30}; do echo -n "."; sleep 0.1; done; echo ""


  pids=$(lsof -ti :$port 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ Process terminated gracefully"
    return 0
  fi

  # Force kill
  echo "  Sending SIGKILL to PID(s): $pids (graceful shutdown failed)"
  kill -9 $pids 2>/dev/null
  sleep 1

  # Final verification
  pids=$(lsof -ti :$port 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ Process force-killed successfully"
    return 0
  else
    echo "  ✗ FAILED: Process still running on port $port"
    echo "    Full process info:"
    lsof -i :$port | tail -n +2
    return 1
  fi
}

#----------------------------------------------
# Function to kill by pattern and verify
kill_process_by_pattern() {
  local pattern=$1
  local service_name=$2

  echo "Stopping $service_name"

  pids=$(pgrep -f "$pattern" 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ No process matching '$pattern' found"
    return 0
  fi

  # Graceful termination
  echo "  Sending SIGTERM to matching process(es)"
  pkill -f "$pattern" 2>/dev/null
  for i in {1..30}; do echo -n "."; sleep 0.1; done; echo ""

  # Check if still running
  pids=$(pgrep -f "$pattern" 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ Process terminated gracefully"
    return 0
  fi

  # Force kill
  echo "  Sending SIGKILL to matching process(es)"
  pkill -9 -f "$pattern" 2>/dev/null
  sleep 1

  # Final verification
  pids=$(pgrep -f "$pattern" 2>/dev/null)
  if [ -z "$pids" ]; then
    echo "  ✓ Process force-killed successfully"
    return 0
  else
    echo "  ✗ FAILED: Process still running matching '$pattern'"
    return 1
  fi
}

echo "================================================================"
# Kill services in order
# Kill npm and serve first (UI server), then by port as fallback
kill_process_by_pattern "npm.*start" "npm start (UI server)"
kill_process_by_pattern "serve.*3000" "serve static server"
kill_process_on_port 3000 "UI server (port fallback)"
kill_process_by_pattern "matrix-project/proxy" "proxy"
kill_process_by_pattern "matrix-project/coordinator" "coordinator"
kill_process_by_pattern "llama-server" "llama-server"
kill_process_by_pattern "mlx-lm" "mlx-lm"

# This prevented KeepAlive restarts in the background
# Disable the launchd agent permanently
echo ""
echo "Disabling launchd agent (com.caribou.swarm-dashboard)..."
mkdir -p ~/Library/LaunchAgents

# Create a disabled plist to override the active one
cat > ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.caribou.swarm-dashboard</string>
    <key>Disabled</key>
    <true/>
</dict>
</plist>
EOF

# Unload the agent from launchd
launchctl unload ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist 2>/dev/null || true
echo "  ✓ Launchd agent unloaded"

# Final summary
echo ""
echo "========== SHUTDOWN SUMMARY =========="
remaining=$(lsof -ti :3000 2>/dev/null)
if [ -z "$remaining" ]; then
  echo "✓ Port 3000 is free"
else
  echo "✗ Port 3000 still in use by PID(s): $remaining"
  echo "  Process details:"
  lsof -i :3000 | tail -n +2
fi

echo "Shutdown complete. Close web browser if needed."
echo "Note: Launchd agent disabled. To re-enable, delete:"
echo "  ~/Library/LaunchAgents/com.caribou.swarm-dashboard.plist"
echo "================================================================"
