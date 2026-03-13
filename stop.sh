#!/bin/bash
# Stop Matrix Swarm: frontend, backend (proxy), agents, coordinator, and fan control.
# Prompts for Docker vs Bare Metal to match how you started.
# Run from project root: ./stop.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
exec "$SCRIPT_DIR/scripts/shutdown_matrix.sh"
