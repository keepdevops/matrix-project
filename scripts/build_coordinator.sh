#!/bin/bash
set -e

ROOT="$(dirname "$0")/.."
echo "Building coordinator..."
c++ -std=c++17 -O2 -o "$ROOT/coordinator" "$ROOT/coordinator.cpp" -pthread
echo "Done. Binary: $ROOT/coordinator"
