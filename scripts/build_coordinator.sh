#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "ROOT=${ROOT}"

echo "Building coordinator..."
c++ -std=c++17 -O2 -o "$ROOT/coordinator" "$ROOT/src2/coordinator.cpp" -pthread
echo "Done. Binary: $ROOT/coordinator"
ls -la "$ROOT/coordinator"

echo "Building proxy..."
c++ -std=c++17 -O2 -o "$ROOT/proxy" "$ROOT/src2/proxy.cpp" "$ROOT/src2/proxy_configure.cpp" "$ROOT/src2/proxy_validate.cpp" "$ROOT/src2/matrix_env.cpp" -pthread

echo "Done. Binary: $ROOT/proxy"
ls -la "$ROOT/proxy"
