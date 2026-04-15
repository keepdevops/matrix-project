#!/usr/bin/env bash
# Build coordinator and proxy C++ binaries.
# Run from anywhere: bash scripts/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CXX_CMD="${CXX:-c++}"

echo "[build] Compiling coordinator..."
$CXX_CMD -std=c++17 -O2 -o coordinator coordinator.cpp -pthread
echo "  -> $ROOT/coordinator"

echo "[build] Compiling proxy..."
$CXX_CMD -std=c++17 -O2 -o proxy proxy.cpp proxy_configure.cpp matrix_env.cpp -pthread
echo "  -> $ROOT/proxy"

echo "[build] Done."
