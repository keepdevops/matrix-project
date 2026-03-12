#!/bin/bash
# Run matrix-project using pixi (install env, build coordinator, then launch).
# Usage: ./scripts/run_matrix_pixi.sh   or   bash scripts/run_matrix_pixi.sh
# Works from project root or from scripts/; uses this repo's pixi.toml.

set -e

# Project root = directory containing pixi.toml
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/pixi.toml" ]; then
  ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../pixi.toml" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "Error: pixi.toml not found (looked in $SCRIPT_DIR and $SCRIPT_DIR/..)" >&2
  exit 1
fi

MANIFEST="$ROOT/pixi.toml"
cd "$ROOT"

if ! command -v pixi >/dev/null 2>&1; then
  echo "Error: pixi not found. Install from https://pixi.sh" >&2
  exit 1
fi

echo "[1/3] Installing pixi environment..."
pixi install --manifest-path "$MANIFEST"

echo "[2/3] Building coordinator..."
pixi run --manifest-path "$MANIFEST" build-coordinator

echo "[3/3] Launching Matrix Swarm..."
pixi run --manifest-path "$MANIFEST" launch
