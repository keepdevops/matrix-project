#!/bin/bash
# Start Matrix Swarm: frontend, backend (proxy), and optional fan control.
# Prompts for Docker vs Bare Metal for the UI; proxy and fan are always started.
# Run from project root: ./start.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$SCRIPT_DIR/scripts/launch_matrix.sh"
