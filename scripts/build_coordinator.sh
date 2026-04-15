#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Building coordinator..."
c++ -std=c++17 -O2 -o "$ROOT/coordinator" "$ROOT/coordinator.cpp" -pthread
echo "Done. Binary: $ROOT/coordinator"
ls -la "$ROOT/coordinator"

echo "Building proxy..."
c++ -std=c++17 -O2 -o "$ROOT/proxy" "$ROOT/proxy.cpp" "$ROOT/proxy_configure.cpp" "$ROOT/proxy_validate.cpp" "$ROOT/matrix_env.cpp" -pthread
echo "Done. Binary: $ROOT/proxy"
ls -la "$ROOT/proxy"
