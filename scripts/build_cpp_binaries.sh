#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "ROOT=${ROOT}"

echo "Building coordinator..."
###c++ -std=c++17 -O2 -o "$ROOT/bin/coordinator" \

# modes/*.cpp glob picks up registry.cpp and every registered mode, so future
# modes drop in without editing this script.
c++ -std=c++17 -O2 -o "$ROOT/coordinator" \
   "$ROOT/src2/coordinator.cpp" \
   "$ROOT/src2/agent_client.cpp" \
   "$ROOT/src2/agent_health.cpp" \
   "$ROOT/src2/agent_stream.cpp" \
   "$ROOT/src2/pressure.cpp" \
   "$ROOT/src2/pressure_evict.cpp" \
   "$ROOT/src2/response_cache.cpp" \
   "$ROOT/src2/mlx_inflight.cpp" \
   "$ROOT/src2/kv_router.cpp" \
   $ROOT/src2/modes/*.cpp \
   -pthread

echo "Building proxy..."
###c++ -std=c++17 -O2 -o "$ROOT/bin/proxy" \

c++ -std=c++17 -O2 -o "$ROOT/proxy" \
  "$ROOT/src2/proxy.cpp" \
  "$ROOT/src2/proxy_configure.cpp" \
  "$ROOT/src2/proxy_validate.cpp" \
  "$ROOT/src2/matrix_env.cpp" \
  -pthread

### mkdir -p "$ROOT/bin/logs"
### cp "$ROOT/src2/swarm-config.json" "$ROOT/bin/."

mkdir -p "$ROOT/logs"
ls -lart "$ROOT/proxy"
ls -lart "$ROOT/coordinator"

echo "Build complete."
# EOF
