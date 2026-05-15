#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "ROOT=${ROOT}"

mkdir -p "$ROOT/build/modes"

# C++ sources live under cpp_core/src/ (moved from src2/ in Phase 1).
CPP_SRC="$ROOT/cpp_core/src"

echo "Building libmatrix_modes.a (orchestration modes)..."
MOD_OBJS=()
shopt -s nullglob
for f in "$CPP_SRC/modes"/*.cpp; do
  base=$(basename "$f" .cpp)
  obj="$ROOT/build/modes/${base}.o"
  c++ -std=c++17 -O2 -c -o "$obj" "$f" -I"$CPP_SRC"
  MOD_OBJS+=("$obj")
done
shopt -u nullglob
if [ "${#MOD_OBJS[@]}" -eq 0 ]; then
  echo "❌ No sources under cpp_core/src/modes/*.cpp" >&2
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
# prometheus-cpp (header + core lib) is required for /metrics. Installed via
# `brew install prometheus-cpp`. Headers at /opt/homebrew/include/prometheus,
# core dylib at /opt/homebrew/lib/libprometheus-cpp-core.dylib.
PROM_INC="/opt/homebrew/include"
PROM_LIB="/opt/homebrew/lib"

# libpq (keg-only Homebrew) for the optional RAG retrieval path in dispatch.
LIBPQ_PREFIX="/opt/homebrew/opt/libpq"
LIBPQ_INC="$LIBPQ_PREFIX/include"
LIBPQ_LIB="$LIBPQ_PREFIX/lib"

# Compile vendored BLAKE2b as C (header uses extern "C" for C++ callers).
cc -std=c99 -O2 -c -o "$ROOT/build/blake2b.o" "$CPP_SRC/blake2b.c"

c++ -std=c++17 -O2 -o "$ROOT/coordinator" \
   -I"$PROM_INC" -L"$PROM_LIB" \
   -I"$LIBPQ_INC" -L"$LIBPQ_LIB" \
   "$CPP_SRC/coordinator.cpp" \
   "$CPP_SRC/config/coordinator_config_validate.cpp" \
   "$CPP_SRC/config/swarm_config_dir_load.cpp" \
   "$CPP_SRC/config/path_expand.cpp" \
   "$CPP_SRC/telemetry.cpp" \
   "$CPP_SRC/coordinator_context.cpp" \
   "$CPP_SRC/mode_module.cpp" \
   "$CPP_SRC/session_store.cpp" \
   "$CPP_SRC/synthesis_budget.cpp" \
   "$CPP_SRC/synthesis_tiered.cpp" \
   "$CPP_SRC/coordinator_routes.cpp" \
   "$CPP_SRC/coordinator_routes_agents_meta.cpp" \
   "$CPP_SRC/coordinator_routes_core.cpp" \
   "$CPP_SRC/coordinator_routes_dispatch.cpp" \
   "$CPP_SRC/coordinator_routes_architect_stream.cpp" \
   "$CPP_SRC/coordinator_routes_filters.cpp" \
   "$CPP_SRC/coordinator_routes_health_agents.cpp" \
   "$CPP_SRC/coordinator_routes_misc.cpp" \
   "$CPP_SRC/coordinator_routes_modes.cpp" \
   "$CPP_SRC/coordinator_routes_presets.cpp" \
   "$CPP_SRC/coordinator_routes_rag_health.cpp" \
   "$CPP_SRC/swarm_config_store.cpp" \
   "$CPP_SRC/agent_client.cpp" \
   "$CPP_SRC/agent_health.cpp" \
   "$CPP_SRC/agent_metrics.cpp" \
   "$CPP_SRC/agent_stream.cpp" \
   "$CPP_SRC/pressure_snapshot.cpp" \
   "$CPP_SRC/pressure.cpp" \
   "$CPP_SRC/pressure_evict.cpp" \
   "$CPP_SRC/response_cache.cpp" \
   "$CPP_SRC/mlx_inflight.cpp" \
   "$CPP_SRC/kv_router.cpp" \
   "$CPP_SRC/rag_config.cpp" \
   "$CPP_SRC/rag_embed.cpp" \
   "$CPP_SRC/rag_client.cpp" \
   "$ROOT/build/blake2b.o" \
   -I"$CPP_SRC" \
   "${MOD_LINK[@]}" \
   -lprometheus-cpp-core \
   -lpq \
   -pthread

echo "Building proxy..."
c++ -std=c++17 -O2 -o "$ROOT/proxy" \
  "$CPP_SRC/proxy.cpp" \
  "$CPP_SRC/proxy_routes.cpp" \
  "$CPP_SRC/proxy_file_io.cpp" \
  "$CPP_SRC/proxy_models_scan.cpp" \
  "$CPP_SRC/proxy_configure.cpp" \
  "$CPP_SRC/config/path_expand.cpp" \
  "$CPP_SRC/proxy_configure_health.cpp" \
  "$CPP_SRC/proxy_configure_kill_prepare.cpp" \
  "$CPP_SRC/proxy_configure_coordinator_startup.cpp" \
  "$CPP_SRC/proxy_validate.cpp" \
  "$CPP_SRC/matrix_env.cpp" \
  -I"$CPP_SRC" \
  -pthread

### mkdir -p "$ROOT/bin/logs"
### cp "$ROOT/src2/swarm-config.json" "$ROOT/bin/."

mkdir -p "$ROOT/logs"
ls -lart "$ROOT/proxy"
ls -lart "$ROOT/coordinator"
ls -lart "$ROOT/build/libmatrix_modes.a"

echo "Building matrix_config_service..."
c++ -std=c++17 -O2 -o "$ROOT/matrix_config_service" \
  "$CPP_SRC/config_service_main.cpp" \
  -I"$CPP_SRC" \
  -pthread
ls -lart "$ROOT/matrix_config_service"

echo "Building swarm_config_store_test..."
c++ -std=c++17 -O0 -g -o "$ROOT/swarm_config_store_test" \
  "$ROOT/tests/cpp/swarm_config_store_test.cpp" \
  "$CPP_SRC/swarm_config_store.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/swarm_config_store_test"

echo "Building rag_embed_test..."
c++ -std=c++17 -O0 -g -o "$ROOT/rag_embed_test" \
  "$ROOT/tests/cpp/rag_embed_test.cpp" \
  "$CPP_SRC/rag_embed.cpp" \
  "$CPP_SRC/rag_client.cpp" \
  "$ROOT/build/blake2b.o" \
  -I"$CPP_SRC" \
  -I"$LIBPQ_INC" -L"$LIBPQ_LIB" -lpq
ls -lart "$ROOT/rag_embed_test"

echo "Build complete."
# EOF
