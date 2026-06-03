#!/usr/bin/env bash
# MS-151: CMake build for the MLX embed spike (Darwin arm64 only).
# Produces mlx_embed_probe in build/mlx_embed/.
#
# Usage:
#   bash scripts/build_mlx_embed.sh [--clean] [--n 1024]
#   MLX_PREFIX=/custom/path bash scripts/build_mlx_embed.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/build/mlx_embed"
PROBE="$BUILD_DIR/mlx_embed_probe"

# ── Strip WASM/WASI env vars that can poison the CMake compiler probe ─────────
# CFLAGS/LDFLAGS set to --target=wasm32-wasip1 (WASI SDK) break native builds.
unset CFLAGS CXXFLAGS LDFLAGS WASI_SYSROOT

# ── Platform check ────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "❌  MS-151 requires Darwin arm64 (Apple Silicon)." >&2
  echo "    Detected: $(uname -s)/$(uname -m)" >&2
  exit 1
fi

# ── Args ──────────────────────────────────────────────────────────────────────
CLEAN=0
PROBE_N=512
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) CLEAN=1 ;;
    --n)     PROBE_N="$2"; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

# ── Resolve MLX prefix ────────────────────────────────────────────────────────
if [[ -z "${MLX_PREFIX:-}" ]]; then
  CANDIDATES=(
    "${CONDA_PREFIX:-__none__}"
    "$HOME/miniforge3/envs/mlx-env"
    "$HOME/miniconda3/envs/mlx-env"
    "$HOME/opt/miniconda3/envs/mlx-env"
  )
  MLX_PREFIX=""
  for c in "${CANDIDATES[@]}"; do
    if [[ -f "$c/include/mlx/mlx.h" ]]; then
      MLX_PREFIX="$c"
      break
    fi
  done
  if [[ -z "$MLX_PREFIX" ]]; then
    echo "❌  Cannot find MLX installation. Set MLX_PREFIX=/path/to/mlx or" >&2
    echo "    activate the conda env that has mlx installed." >&2
    exit 1
  fi
fi
echo "MLX_PREFIX = $MLX_PREFIX"

# ── CMake configure + build ───────────────────────────────────────────────────
if [[ "$CLEAN" -eq 1 && -d "$BUILD_DIR" ]]; then
  echo "Cleaning $BUILD_DIR"
  rm -rf "$BUILD_DIR"
fi
mkdir -p "$BUILD_DIR"

cmake -S "$ROOT/cpp_core" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release \
  -DMLX_PREFIX="$MLX_PREFIX" \
  -DCMAKE_OSX_ARCHITECTURES=arm64

cmake --build "$BUILD_DIR" -j"$(sysctl -n hw.logicalcpu)"

# ── Fix dylib rpath: both libmlx.dylib copies use @rpath/libmlx.dylib as their
# install name.  CMake auto-prepends the link-time directory to rpath, so the
# wrong (older) copy wins.  Patch the probe binaries to use the absolute path
# of the site-packages copy which matches the mlx/core Python extension.
SITEPKG_LIB="$MLX_PREFIX/lib/python3.12/site-packages/mlx/lib/libmlx.dylib"
for BIN in "$BUILD_DIR/mlx_embed_probe" "$BUILD_DIR/mlx_generate_probe" "$BUILD_DIR/mlx_bench_probe"; do
  if [[ -f "$BIN" ]]; then
    install_name_tool -change @rpath/libmlx.dylib "$SITEPKG_LIB" "$BIN" 2>/dev/null || true
    echo "patched rpath in $(basename $BIN)"
  fi
done

echo ""
echo "Binary: $PROBE"
ls -lh "$PROBE"

# ── Run probe ────────────────────────────────────────────────────────────────
echo ""
echo "Running probe (n=$PROBE_N)…"
"$PROBE" "$PROBE_N"
