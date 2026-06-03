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

set(MLX_INCLUDE "${MLX_PREFIX}/include")
set(MLX_LIB     "${MLX_PREFIX}/lib/libmlx.dylib")

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

# ── Probe binary ─────────────────────────────────────────────────────────────
add_executable(mlx_embed_probe
  ../tests/cpp/mlx_embed_probe.cpp)

target_link_libraries(mlx_embed_probe PRIVATE matrix_mlx_embed_lib)
target_compile_definitions(mlx_embed_probe PRIVATE MATRIX_MLX_EMBED=1)

# Set rpath so the binary finds libmlx.dylib at runtime
set_target_properties(mlx_embed_probe PROPERTIES
  BUILD_RPATH "${MLX_PREFIX}/lib"
  INSTALL_RPATH "${MLX_PREFIX}/lib")

message(STATUS "Configured matrix_mlx_embed for ${CMAKE_SYSTEM_NAME}/${CMAKE_SYSTEM_PROCESSOR}")
message(STATUS "Build with: cmake --build <build-dir> --target mlx_embed_probe")
