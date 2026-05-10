#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "ROOT=${ROOT}"

mkdir -p "$ROOT/build/modes"

echo "Building libmatrix_modes.a (orchestration modes)..."
MOD_OBJS=()
shopt -s nullglob
for f in "$ROOT/src2/modes"/*.cpp; do
  base=$(basename "$f" .cpp)
  obj="$ROOT/build/modes/${base}.o"
  c++ -std=c++17 -O2 -c -o "$obj" "$f" -I"$ROOT/src2"
  MOD_OBJS+=("$obj")
done
shopt -u nullglob
if [ "${#MOD_OBJS[@]}" -eq 0 ]; then
  echo "❌ No sources under src2/modes/*.cpp" >&2
  exit 1
fi
ar rcs "$ROOT/build/libmatrix_modes.a" "${MOD_OBJS[@]}"

uname_s="$(uname -s)"
MOD_LINK=()
if [ "$uname_s" = "Darwin" ]; then
  MOD_LINK+=( -Wl,-force_load,"$ROOT/build/libmatrix_modes.a" )
else
  MOD_LINK+=( -Wl,--whole-archive "$ROOT/build/libmatrix_modes.a" -Wl,--no-whole-archive )
fi

echo "Building coordinator..."
c++ -std=c++17 -O2 -o "$ROOT/coordinator" \
   "$ROOT/src2/coordinator.cpp" \
   "$ROOT/src2/config/coordinator_config_validate.cpp" \
   "$ROOT/src2/coordinator_context.cpp" \
   "$ROOT/src2/mode_module.cpp" \
   "$ROOT/src2/session_store.cpp" \
   "$ROOT/src2/synthesis_budget.cpp" \
   "$ROOT/src2/synthesis_tiered.cpp" \
   "$ROOT/src2/coordinator_routes.cpp" \
   "$ROOT/src2/coordinator_routes_agents_meta.cpp" \
   "$ROOT/src2/coordinator_routes_core.cpp" \
   "$ROOT/src2/coordinator_routes_dispatch.cpp" \
   "$ROOT/src2/coordinator_routes_architect_stream.cpp" \
   "$ROOT/src2/coordinator_routes_filters.cpp" \
   "$ROOT/src2/coordinator_routes_health_agents.cpp" \
   "$ROOT/src2/coordinator_routes_misc.cpp" \
   "$ROOT/src2/coordinator_routes_modes.cpp" \
   "$ROOT/src2/coordinator_routes_presets.cpp" \
   "$ROOT/src2/swarm_config_store.cpp" \
   "$ROOT/src2/agent_client.cpp" \
   "$ROOT/src2/agent_health.cpp" \
   "$ROOT/src2/agent_metrics.cpp" \
   "$ROOT/src2/agent_stream.cpp" \
   "$ROOT/src2/pressure_snapshot.cpp" \
   "$ROOT/src2/pressure.cpp" \
   "$ROOT/src2/pressure_evict.cpp" \
   "$ROOT/src2/response_cache.cpp" \
   "$ROOT/src2/mlx_inflight.cpp" \
   "$ROOT/src2/kv_router.cpp" \
   "${MOD_LINK[@]}" \
   -pthread

echo "Building proxy..."
###c++ -std=c++17 -O2 -o "$ROOT/bin/proxy" \

c++ -std=c++17 -O2 -o "$ROOT/proxy" \
  "$ROOT/src2/proxy.cpp" \
  "$ROOT/src2/proxy_routes.cpp" \
  "$ROOT/src2/proxy_file_io.cpp" \
  "$ROOT/src2/proxy_models_scan.cpp" \
  "$ROOT/src2/proxy_configure.cpp" \
  "$ROOT/src2/proxy_configure_health.cpp" \
  "$ROOT/src2/proxy_configure_kill_prepare.cpp" \
  "$ROOT/src2/proxy_configure_coordinator_startup.cpp" \
  "$ROOT/src2/proxy_validate.cpp" \
  "$ROOT/src2/matrix_env.cpp" \
  -pthread

### mkdir -p "$ROOT/bin/logs"
### cp "$ROOT/src2/swarm-config.json" "$ROOT/bin/."

mkdir -p "$ROOT/logs"
ls -lart "$ROOT/proxy"
ls -lart "$ROOT/coordinator"
ls -lart "$ROOT/build/libmatrix_modes.a"

echo "Building matrix_config_service..."
c++ -std=c++17 -O2 -o "$ROOT/matrix_config_service" \
  "$ROOT/src2/config_service_main.cpp" \
  -I"$ROOT/src2" \
  -pthread
ls -lart "$ROOT/matrix_config_service"

echo "Building swarm_config_store_test..."
c++ -std=c++17 -O0 -g -o "$ROOT/swarm_config_store_test" \
  "$ROOT/tests/cpp/swarm_config_store_test.cpp" \
  "$ROOT/src2/swarm_config_store.cpp" \
  -I"$ROOT/src2"
ls -lart "$ROOT/swarm_config_store_test"

echo "Build complete."
# EOF
