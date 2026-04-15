#!/usr/bin/env bash
# Validate MATRIX_* paths before starting the proxy. Exit 1 if model dir is missing.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/matrix-env.sh"

ERR=0
warn() { echo "  [warn] $*" >&2; }
bad() { echo "  [error] $*" >&2; ERR=1; }

[[ -d "$MATRIX_MODEL_DIR" ]] || bad "MATRIX_MODEL_DIR is not a directory: $MATRIX_MODEL_DIR"
[[ -x "$MATRIX_LLAMA_SERVER" ]] || warn "MATRIX_LLAMA_SERVER not executable (OK if you only use MLX): $MATRIX_LLAMA_SERVER"
[[ -x "$MATRIX_MLX_PYTHON" ]] || warn "MATRIX_MLX_PYTHON not found or not executable: $MATRIX_MLX_PYTHON"

if [[ $ERR -ne 0 ]]; then
  echo "Adjust paths or run: source scripts/matrix-env.sh" >&2
  exit 1
fi
echo "MATRIX_* validation OK."
exit 0
