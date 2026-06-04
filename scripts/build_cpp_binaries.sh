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

# MS-132: opt-in flag for the native MLX coordinator routes.
# Set MATRIX_MLX_NATIVE_COORD=1 in the environment to enable.
MLX_FLAGS=()
MLX_SOURCES=()
if [ "${MATRIX_MLX_NATIVE_COORD:-0}" = "1" ]; then
  MLX_FLAGS+=("-DMATRIX_MLX_NATIVE_COORD=1")
  # MS-68 Phase 2a: the unified model registry (accounting + pressure) links into
  # the coordinator whenever native MLX routes are on. Gated here so the standard
  # build (no NATIVE_COORD) stays byte-identical.
  MLX_SOURCES+=("$CPP_SRC/model_registry.cpp")
  echo "MLX native coordinator routes ENABLED (MATRIX_MLX_NATIVE_COORD=1)"
fi

# MS-161 Phase D: opt-in AddressSanitizer build for the ship-gate sanitizer run.
# Set MATRIX_SANITIZE=address. LeakSanitizer is unavailable on macOS arm64;
# ASan still catches use-after-free / overflows. For the optional MATRIX_MLX_INPROC
# build, pass LSAN_OPTIONS=suppressions=scripts/asan_python.supp to silence the
# embedded-CPython allocator false positives.
SANITIZE_FLAGS=()
if [ "${MATRIX_SANITIZE:-}" = "address" ]; then
  SANITIZE_FLAGS+=("-fsanitize=address" "-fno-omit-frame-pointer" "-g")
  echo "AddressSanitizer ENABLED (MATRIX_SANITIZE=address)"
fi

# MS-161 Phase B: opt-in in-process MLX inference (embeds CPython + mlx_lm in the
# coordinator). Darwin arm64 only. Set MATRIX_MLX_INPROC=1 to enable.
# model_registry_embed.cpp embeds Python via PyRun_String — needs libpython only;
# libmlx is dlopen'd transitively by Python's mlx extension at runtime.
INPROC_FLAGS=()
INPROC_INCLUDES=()
INPROC_SOURCES=()
INPROC_LIBS=()
if [ "${MATRIX_MLX_INPROC:-0}" = "1" ]; then
  MLX_ENV="${MLX_ENV_PREFIX:-$HOME/miniforge3/envs/mlx-env}"
  PY_INC="$MLX_ENV/include/python3.12"
  PY_DYLIB="$MLX_ENV/lib/libpython3.12.dylib"
  if [ ! -f "$PY_INC/Python.h" ] || [ ! -f "$PY_DYLIB" ]; then
    echo "FATAL: MATRIX_MLX_INPROC=1 but libpython3.12 not found under $MLX_ENV" >&2
    exit 4
  fi
  INPROC_FLAGS+=("-DMATRIX_MLX_INPROC=1" "-DMATRIX_MLX_EMBED=1")
  INPROC_INCLUDES+=("-I$PY_INC")
  INPROC_SOURCES+=("$CPP_SRC/model_registry_embed.cpp")
  INPROC_SOURCES+=("$CPP_SRC/model_registry_prompt_cache.cpp")  # MS-68 2c′-B
  INPROC_SOURCES+=("$CPP_SRC/model_registry_prompt_cache_codegen.cpp")  # #291: pure codegen
  INPROC_LIBS+=("$PY_DYLIB" "-Wl,-rpath,$MLX_ENV/lib")
  echo "MLX in-process inference ENABLED (MATRIX_MLX_INPROC=1) — linking $PY_DYLIB"
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

c++ -std=c++17 -O2 "${MLX_FLAGS[@]}" "${SANITIZE_FLAGS[@]}" "${INPROC_FLAGS[@]}" "${INPROC_INCLUDES[@]}" -o "$ROOT/coordinator" \
   -I"$PROM_INC" -L"$PROM_LIB" \
   -I"$LIBPQ_INC" -L"$LIBPQ_LIB" \
   "$CPP_SRC/coordinator.cpp" \
   "$CPP_SRC/coordinator_setup.cpp" \
   "$CPP_SRC/config/swarm_config_resolve.cpp" \
   "$CPP_SRC/config/coordinator_config_validate.cpp" \
   "$CPP_SRC/config/swarm_config_dir_load.cpp" \
   "$CPP_SRC/config/path_expand.cpp" \
   "$CPP_SRC/telemetry.cpp" \
   "$CPP_SRC/coordinator_context.cpp" \
   "$CPP_SRC/mode_module.cpp" \
   "$CPP_SRC/session_store.cpp" \
   "$CPP_SRC/session_store_text.cpp" \
   "$CPP_SRC/token_ledger.cpp" \
   "$CPP_SRC/rss_generator.cpp" \
   "$CPP_SRC/synthesis_budget.cpp" \
   "$CPP_SRC/synthesis_budget_assemble.cpp" \
   "$CPP_SRC/synthesis_tiered.cpp" \
   "$CPP_SRC/coordinator_routes.cpp" \
   "$CPP_SRC/coordinator_routes_mlx.cpp" \
   "$CPP_SRC/mlx_session_store.cpp" \
   "$CPP_SRC/coordinator_routes_agents_meta.cpp" \
   "$CPP_SRC/coordinator_routes_agent_tokens.cpp" \
   "$CPP_SRC/coordinator_routes_core.cpp" \
   "$CPP_SRC/coordinator_routes_dispatch.cpp" \
   "$CPP_SRC/coordinator_routes_dispatch_prepare.cpp" \
   "$CPP_SRC/coordinator_routes_architect_stream.cpp" \
   "$CPP_SRC/coordinator_routes_architect_stream_modes.cpp" \
   "$CPP_SRC/coordinator_routes_architect_stream_pipeline.cpp" \
   "$CPP_SRC/coordinator_routes_architect_stream_router.cpp" \
   "$CPP_SRC/coordinator_routes_architect_synthesis.cpp" \
   "$CPP_SRC/coordinator_routes_architect_persist.cpp" \
   "$CPP_SRC/coordinator_routes_filters.cpp" \
   "$CPP_SRC/coordinator_routes_health_agents.cpp" \
   "$CPP_SRC/coordinator_routes_misc.cpp" \
   "$CPP_SRC/coordinator_kv_ops.cpp" \
   "$CPP_SRC/coordinator_routes_cache.cpp" \
   "$CPP_SRC/coordinator_routes_modes.cpp" \
   "$CPP_SRC/coordinator_routes_modes_put.cpp" \
   "$CPP_SRC/coordinator_routes_presets.cpp" \
   "$CPP_SRC/coordinator_routes_rag_health.cpp" \
   "$CPP_SRC/swarm_config_store.cpp" \
   "$CPP_SRC/swarm_config_roster.cpp" \
   "$CPP_SRC/agent_client.cpp" \
   "$CPP_SRC/agent_client_http.cpp" \
   "$CPP_SRC/inference_backend.cpp" \
   "$CPP_SRC/inference_backend_http.cpp" \
   "$CPP_SRC/backend_router.cpp" \
   "$CPP_SRC/agent_client_pool.cpp" \
   "$CPP_SRC/agent_health.cpp" \
   "$CPP_SRC/agent_metrics.cpp" \
   "$CPP_SRC/agent_stream.cpp" \
   "$CPP_SRC/agent_stream_pool.cpp" \
   "$CPP_SRC/agent_stream_sse.cpp" \
   "$CPP_SRC/pressure_snapshot.cpp" \
   "$CPP_SRC/pressure_snapshot_llama.cpp" \
   "$CPP_SRC/pressure_snapshot_mlx.cpp" \
   "$CPP_SRC/host_memory.cpp" \
   "$CPP_SRC/pressure.cpp" \
   "$CPP_SRC/pressure_evict.cpp" \
   "$CPP_SRC/pressure_evict_score.cpp" \
   "$CPP_SRC/response_cache.cpp" \
   "$CPP_SRC/mlx_inflight.cpp" \
   "$CPP_SRC/kv_router.cpp" \
   "$CPP_SRC/code_fence_normalize.cpp" \
   "$CPP_SRC/rag_config.cpp" \
   "$CPP_SRC/rag_embed.cpp" \
   "$CPP_SRC/rag_client.cpp" \
   "$CPP_SRC/rag_client_http.cpp" \
   "$ROOT/build/blake2b.o" \
   "${MLX_SOURCES[@]}" \
   "${INPROC_SOURCES[@]}" \
   -I"$CPP_SRC" \
   "${MOD_LINK[@]}" \
   "${INPROC_LIBS[@]}" \
   -lprometheus-cpp-core \
   -lpq \
   -pthread

echo "Building proxy..."
c++ -std=c++17 -O2 -o "$ROOT/proxy" \
  "$CPP_SRC/proxy.cpp" \
  "$CPP_SRC/proxy_routes.cpp" \
  "$CPP_SRC/proxy_routes_system.cpp" \
  "$CPP_SRC/proxy_routes_convert.cpp" \
  "$CPP_SRC/proxy_routes_convert_jobs.cpp" \
  "$CPP_SRC/proxy_routes_orchestrate.cpp" \
  "$CPP_SRC/proxy_file_io.cpp" \
  "$CPP_SRC/proxy_models_scan.cpp" \
  "$CPP_SRC/proxy_configure.cpp" \
  "$CPP_SRC/proxy_configure_ports_build.cpp" \
  "$CPP_SRC/proxy_configure_ports_write.cpp" \
  "$CPP_SRC/proxy_configure_spawn.cpp" \
  "$CPP_SRC/config/path_expand.cpp" \
  "$CPP_SRC/proxy_configure_health.cpp" \
  "$CPP_SRC/host_memory.cpp" \
  "$CPP_SRC/proxy_configure_kill_prepare.cpp" \
  "$CPP_SRC/proxy_configure_coordinator_startup.cpp" \
  "$CPP_SRC/proxy_validate.cpp" \
  "$CPP_SRC/proxy_validate_vllm.cpp" \
  "$CPP_SRC/proxy_validate_gguf.cpp" \
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
  "$CPP_SRC/swarm_config_roster.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/swarm_config_store_test"

echo "Building code_fence_normalize_test..."
c++ -std=c++17 -O0 -g -o "$ROOT/code_fence_normalize_test" \
  "$ROOT/tests/cpp/code_fence_normalize_test.cpp" \
  "$CPP_SRC/code_fence_normalize.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/code_fence_normalize_test"

echo "Building test_kv_token_semaphore..."
c++ -std=c++17 -O0 -g "${SANITIZE_FLAGS[@]}" -o "$ROOT/test_kv_token_semaphore" \
  "$ROOT/tests/cpp/test_kv_token_semaphore.cpp" \
  "$CPP_SRC/agent_client_pool.cpp" \
  -I"$CPP_SRC" -pthread
ls -lart "$ROOT/test_kv_token_semaphore"

BACKEND_TEST_SRCS=(
  "$CPP_SRC/inference_backend.cpp"
  "$CPP_SRC/backend_router.cpp"
)

echo "Building test_backend_registry..."
c++ -std=c++17 -O0 -g "${SANITIZE_FLAGS[@]}" -o "$ROOT/test_backend_registry" \
  "$ROOT/tests/cpp/test_backend_registry.cpp" \
  "${BACKEND_TEST_SRCS[@]}" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_backend_registry"

echo "Building test_backend_selection..."
c++ -std=c++17 -O0 -g "${SANITIZE_FLAGS[@]}" -o "$ROOT/test_backend_selection" \
  "$ROOT/tests/cpp/test_backend_selection.cpp" \
  "${BACKEND_TEST_SRCS[@]}" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_backend_selection"

echo "Building test_backend_router..."
c++ -std=c++17 -O0 -g "${SANITIZE_FLAGS[@]}" -o "$ROOT/test_backend_router" \
  "$ROOT/tests/cpp/test_backend_router.cpp" \
  "${BACKEND_TEST_SRCS[@]}" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_backend_router"

echo "Building test_routing_decision_log..."
c++ -std=c++17 -O0 -g "${SANITIZE_FLAGS[@]}" -o "$ROOT/test_routing_decision_log" \
  "$ROOT/tests/cpp/test_routing_decision_log.cpp" \
  "${BACKEND_TEST_SRCS[@]}" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_routing_decision_log"

echo "Building test_rss_generator..."
c++ -std=c++17 -O0 -g -o "$ROOT/test_rss_generator" \
  "$ROOT/tests/cpp/test_rss_generator.cpp" \
  "$CPP_SRC/rss_generator.cpp" \
  -I"$CPP_SRC" -pthread
ls -lart "$ROOT/test_rss_generator"

echo "Building test_model_registry..."
c++ -std=c++17 -O0 -g -o "$ROOT/test_model_registry" \
  "$ROOT/tests/cpp/test_model_registry.cpp" \
  "$CPP_SRC/model_registry.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_model_registry"

echo "Building test_prompt_cache_lcp..."
c++ -std=c++17 -O0 -g -o "$ROOT/test_prompt_cache_lcp" \
  "$ROOT/tests/cpp/test_prompt_cache_lcp.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_prompt_cache_lcp"

echo "Building test_prompt_cache_codegen..."  # #291: kv_bits codegen guard (pure)
c++ -std=c++17 -O0 -g -o "$ROOT/test_prompt_cache_codegen" \
  "$ROOT/tests/cpp/test_prompt_cache_codegen.cpp" \
  "$CPP_SRC/model_registry_prompt_cache_codegen.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_prompt_cache_codegen"

echo "Building test_mlx_mem_guard..."  # MS-171B: pressure_exceeds_at decision (pure)
c++ -std=c++17 -O0 -g -o "$ROOT/test_mlx_mem_guard" \
  "$ROOT/tests/cpp/test_mlx_mem_guard.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_mlx_mem_guard"

echo "Building test_tes_compute..."  # MS-70/72: Token Efficiency Score math (pure)
c++ -std=c++17 -O0 -g -o "$ROOT/test_tes_compute" \
  "$ROOT/tests/cpp/test_tes_compute.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_tes_compute"

echo "Building test_token_ledger..."  # MS-71/73: token accounting + overrun gate
c++ -std=c++17 -O0 -g -o "$ROOT/test_token_ledger" \
  "$ROOT/tests/cpp/test_token_ledger.cpp" \
  "$CPP_SRC/token_ledger.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_token_ledger"

echo "Building test_token_budget_hierarchy..."  # MS-84: agent>mode>global resolve (pure)
c++ -std=c++17 -O0 -g -o "$ROOT/test_token_budget_hierarchy" \
  "$ROOT/tests/cpp/test_token_budget_hierarchy.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_token_budget_hierarchy"

echo "Building test_kv_layer_entropy..."  # MS-91: rank_for_eviction contract (pure)
c++ -std=c++17 -O0 -g -o "$ROOT/test_kv_layer_entropy" \
  "$ROOT/tests/cpp/test_kv_layer_entropy.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_kv_layer_entropy"

echo "Building test_port_assign..."
c++ -std=c++17 -O0 -g -o "$ROOT/test_port_assign" \
  "$ROOT/tests/cpp/test_port_assign.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_port_assign"

echo "Building test_sse_usage_capture..."
c++ -std=c++17 -O0 -g -o "$ROOT/test_sse_usage_capture" \
  "$ROOT/tests/cpp/test_sse_usage_capture.cpp" \
  -I"$CPP_SRC"
ls -lart "$ROOT/test_sse_usage_capture"

echo "Building rag_embed_test..."
c++ -std=c++17 -O0 -g -o "$ROOT/rag_embed_test" \
  "$ROOT/tests/cpp/rag_embed_test.cpp" \
  "$CPP_SRC/rag_embed.cpp" \
  "$CPP_SRC/rag_client.cpp" \
  "$CPP_SRC/rag_client_http.cpp" \
  "$ROOT/build/blake2b.o" \
  -I"$CPP_SRC" \
  -I"$LIBPQ_INC" -L"$LIBPQ_LIB" -lpq
ls -lart "$ROOT/rag_embed_test"

echo "Build complete."
# EOF
