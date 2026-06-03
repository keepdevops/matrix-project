cmake_minimum_required(VERSION 3.20)
project(matrix_mlx_embed CXX)

# ── Platform guard: Darwin arm64 only ────────────────────────────────────────
if(NOT (CMAKE_SYSTEM_NAME STREQUAL "Darwin"
        AND CMAKE_SYSTEM_PROCESSOR STREQUAL "arm64"))
  message(FATAL_ERROR
    "matrix_mlx_embed requires Darwin arm64 (Apple Silicon). "
    "Found: ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}. "
    "Use the bash build for other platforms.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# WASI SDK env vars (CFLAGS/LDFLAGS set to --target=wasm32-wasip1) can poison
# the compiler probe.  Override to ensure native compilation.
set(CMAKE_C_FLAGS   "" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "" CACHE STRING "" FORCE)

# ── Find MLX installation ────────────────────────────────────────────────────
# Search order: MLX_PREFIX env → active conda env → miniforge mlx-env default.
if(DEFINED ENV{MLX_PREFIX})
  set(MLX_PREFIX "$ENV{MLX_PREFIX}")
elseif(DEFINED ENV{CONDA_PREFIX}
       AND EXISTS "$ENV{CONDA_PREFIX}/include/mlx/mlx.h")
  set(MLX_PREFIX "$ENV{CONDA_PREFIX}")
else()
  # Hardcoded fallback: miniforge mlx-env (standard install location)
  set(MLX_PREFIX
    "$ENV{HOME}/miniforge3/envs/mlx-env"
    CACHE PATH "Root of the MLX installation")
endif()

message(STATUS "MLX_PREFIX = ${MLX_PREFIX}")

# Prefer site-packages copies of headers + dylib over the top-level ones.
# The Python extension mlx/core.so and site-packages/mlx/lib/libmlx.dylib are
# compiled together and must match; the top-level include/ + lib/ may differ.
set(MLX_SITEPKG "${MLX_PREFIX}/lib/python3.12/site-packages/mlx")
if(EXISTS "${MLX_SITEPKG}/include/mlx/mlx.h"
   AND EXISTS "${MLX_SITEPKG}/lib/libmlx.dylib")
  set(MLX_INCLUDE "${MLX_SITEPKG}/include")
  set(MLX_LIB     "${MLX_SITEPKG}/lib/libmlx.dylib")
  message(STATUS "Using site-packages MLX headers+lib (version-matched)")
else()
  set(MLX_INCLUDE "${MLX_PREFIX}/include")
  set(MLX_LIB     "${MLX_PREFIX}/lib/libmlx.dylib")
  message(STATUS "Using top-level MLX headers+lib")
endif()
message(STATUS "MLX_LIB = ${MLX_LIB}")

if(NOT EXISTS "${MLX_INCLUDE}/mlx/mlx.h")
  message(FATAL_ERROR
    "mlx/mlx.h not found under ${MLX_INCLUDE}. "
    "Set -DMLX_PREFIX=/path/to/mlx-install or export MLX_PREFIX.")
endif()
if(NOT EXISTS "${MLX_LIB}")
  message(FATAL_ERROR
    "libmlx.dylib not found at ${MLX_LIB}. "
    "Set -DMLX_PREFIX=/path/to/mlx-install.")
endif()

# ── MLX imported target ───────────────────────────────────────────────────────
add_library(mlx SHARED IMPORTED)
set_target_properties(mlx PROPERTIES
  IMPORTED_LOCATION "${MLX_LIB}"
  INTERFACE_INCLUDE_DIRECTORIES "${MLX_INCLUDE}")

# Metal and Accelerate are required for libmlx.dylib on macOS
find_library(METAL_FW    Metal    REQUIRED)
find_library(ACCEL_FW    Accelerate REQUIRED)
find_library(FOUNDATION_FW Foundation REQUIRED)

# ── Embed wrapper library ────────────────────────────────────────────────────
add_library(matrix_mlx_embed_lib STATIC
  src/mlx_embed.cpp)

target_include_directories(matrix_mlx_embed_lib PUBLIC src)
target_compile_definitions(matrix_mlx_embed_lib PUBLIC MATRIX_MLX_EMBED=1)
target_link_libraries(matrix_mlx_embed_lib PUBLIC
  mlx
  "${METAL_FW}"
  "${ACCEL_FW}"
  "${FOUNDATION_FW}")

# ── Probe binary (MS-151) ────────────────────────────────────────────────────
add_executable(mlx_embed_probe
  ../tests/cpp/mlx_embed_probe.cpp)

target_link_libraries(mlx_embed_probe PRIVATE matrix_mlx_embed_lib)
target_compile_definitions(mlx_embed_probe PRIVATE MATRIX_MLX_EMBED=1)

set_target_properties(mlx_embed_probe PROPERTIES
  BUILD_RPATH  "${MLX_PREFIX}/lib/python3.12/site-packages/mlx/lib;${MLX_PREFIX}/lib"
  INSTALL_RPATH "${MLX_PREFIX}/lib/python3.12/site-packages/mlx/lib;${MLX_PREFIX}/lib")

# ── CPython embedding (MS-152) ────────────────────────────────────────────────
# Locate the Python 3.12 shared library and headers inside MLX_PREFIX (the
# mlx-env conda environment ships its own Python runtime).
set(PY_INCLUDE "${MLX_PREFIX}/include/python3.12")
set(PY_LIB     "${MLX_PREFIX}/lib/libpython3.12.dylib")

if(EXISTS "${PY_INCLUDE}/Python.h" AND EXISTS "${PY_LIB}")
  message(STATUS "Python 3.12 found at ${MLX_PREFIX} — building mlx_generate_probe")

  add_library(matrix_mlx_generate_lib STATIC
    src/mlx_embed_generate.cpp)

  target_include_directories(matrix_mlx_generate_lib PUBLIC src "${PY_INCLUDE}")
  target_compile_definitions(matrix_mlx_generate_lib PUBLIC MATRIX_MLX_EMBED=1)
  target_link_libraries(matrix_mlx_generate_lib PUBLIC
    matrix_mlx_embed_lib
    "${PY_LIB}")

  add_executable(mlx_generate_probe
    ../tests/cpp/mlx_generate_probe.cpp)

  target_link_libraries(mlx_generate_probe PRIVATE matrix_mlx_generate_lib)
  target_compile_definitions(mlx_generate_probe PRIVATE MATRIX_MLX_EMBED=1)

  set_target_properties(mlx_generate_probe PROPERTIES
    BUILD_RPATH  "${MLX_PREFIX}/lib"
    INSTALL_RPATH "${MLX_PREFIX}/lib")

  # MS-153: warm/cold/RSS benchmark probe (reuses matrix_mlx_generate_lib).
  add_executable(mlx_bench_probe
    ../tests/cpp/mlx_bench_probe.cpp)
  target_link_libraries(mlx_bench_probe PRIVATE matrix_mlx_generate_lib)
  target_compile_definitions(mlx_bench_probe PRIVATE MATRIX_MLX_EMBED=1)
  set_target_properties(mlx_bench_probe PROPERTIES
    BUILD_RPATH  "${MLX_PREFIX}/lib"
    INSTALL_RPATH "${MLX_PREFIX}/lib")

  # MS-160: concurrency efficiency probe (GIL under multi-agent load).
  add_executable(mlx_concurrency_probe
    ../tests/cpp/mlx_concurrency_probe.cpp)
  target_link_libraries(mlx_concurrency_probe PRIVATE matrix_mlx_generate_lib)
  target_compile_definitions(mlx_concurrency_probe PRIVATE MATRIX_MLX_EMBED=1)
  set_target_properties(mlx_concurrency_probe PROPERTIES
    BUILD_RPATH  "${MLX_PREFIX}/lib"
    INSTALL_RPATH "${MLX_PREFIX}/lib")
else()
  message(WARNING
    "Python 3.12 not found at ${MLX_PREFIX} — skipping mlx_generate_probe. "
    "Expected: ${PY_INCLUDE}/Python.h and ${PY_LIB}")
endif()

message(STATUS "Configured matrix_mlx_embed for ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}")
