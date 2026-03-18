#!/bin/bash

echo "========================================"
echo "$0"
echo "  MATRIX SWARM START UP"
echo "========================================"

set -e

echo "-1---------------------------------------"
# Project root = directory containing pixi.toml
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$SCRIPT_DIR/pixi.toml" ]; then
  ROOT="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../pixi.toml" ]; then
  ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  echo "Error: pixi.toml not found (looked in $SCRIPT_DIR and $SCRIPT_DIR/..)" 
  exit 1
fi

echo "-2---------------------------------------"
MANIFEST="$ROOT/pixi.toml"
cd "$ROOT"

if ! command -v pixi >/dev/null ; then
  echo "Error: pixi not found. Install from https://pixi.sh" 
  exit 1
fi

echo "-3---------------------------------------"
echo " Installing pixi environment..."
pixi install --manifest-path "$MANIFEST"

echo "-4---------------------------------------"
echo "    $MANIFEST"
echo " Building coordinator..."

###old-way# pixi run --manifest-path "$MANIFEST" build-coordinator
$ROOT/scripts/build_coordinator.sh

echo "-5---------------------------------------"
echo " Launching Matrix Swarm..."
pixi run --manifest-path "$MANIFEST" launch

echo "-6---------------------------------------"

echo "==============================================="
echo "  MATRIX SWARM START UP COMPLETE"
echo "==============================================="
echo "Next... goto Firefox:3000 and LAUNCH SWARM"
