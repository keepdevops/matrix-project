#!/usr/bin/env bash
# Print suggested Matrix environment exports (defaults by OS / layout).
# Usage:
echo "---------------------------------------------"
echo "${BASH_SOURCE[0]}"

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
OS="$(uname -s)"


if [[ -n "${MATRIX_MODEL_DIR:-}" ]]; then
  MODEL_DIR="$MATRIX_MODEL_DIR"
elif [[ "$OS" == "Darwin" ]]; then
  MODEL_DIR="/Users/Shared/llama/models"
fi


if [[ -n "${MATRIX_LLAMA_SERVER:-}" ]]; then
  LLAMA_BIN="$MATRIX_LLAMA_SERVER"
elif [[ "$OS" == "Darwin" ]]; then
  LLAMA_BIN="/Users/Shared/llama/llama-server"
elif [[ -x /usr/local/bin/llama-server ]]; then
  LLAMA_BIN="/usr/local/bin/llama-server"
fi


: "${MATRIX_ACTIVE_CONFIG:=/tmp/matrix-active-config.json}"
: "${MATRIX_SLOTS_DIR:=/tmp/matrix-slots}"
: "${MATRIX_PROXY_PORT:=3002}"
: "${MATRIX_COORDINATOR_PORT:=8000}"

if [[ -n "${MATRIX_MLX_PYTHON:-}" ]]; then
  MLX_PY="$MATRIX_MLX_PYTHON"
else
  # Search common conda install roots for any env that contains mlx_lm.
  # Checks env names in priority order: matrix-mlx, mlx-env, mlx, base.
  _conda_mlx_found=""
  for _root in \
    "$HOME/miniforge3" "$HOME/mambaforge" "$HOME/miniconda3" \
    "$HOME/anaconda3" "/opt/homebrew/Caskroom/miniforge/base" "/opt/conda"
  do
    for _env_name in matrix-mlx mlx-env mlx; do
      _candidate="$_root/envs/$_env_name/bin/python3"
      if [[ -x "$_candidate" ]]; then _conda_mlx_found="$_candidate"; break 2; fi
    done
  done
  MLX_PY="${_conda_mlx_found:-$(command -v python3 2>/dev/null || echo /usr/bin/python3)}"
fi

export MATRIX_MODEL_DIR="$MODEL_DIR"
export MATRIX_LLAMA_SERVER="$LLAMA_BIN"
export MATRIX_ACTIVE_CONFIG
export MATRIX_SLOTS_DIR
export MATRIX_PROXY_PORT
export MATRIX_COORDINATOR_PORT
export MATRIX_MLX_PYTHON="$MLX_PY"

if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  echo "# Add to your shell or systemd EnvironmentFile:"
  echo "export MATRIX_MODEL_DIR=$MATRIX_MODEL_DIR"
  echo "export MATRIX_LLAMA_SERVER=$MATRIX_LLAMA_SERVER"
  echo "export MATRIX_ACTIVE_CONFIG=$MATRIX_ACTIVE_CONFIG"
  echo "export MATRIX_SLOTS_DIR=$MATRIX_SLOTS_DIR"
  echo "export MATRIX_PROXY_PORT=$MATRIX_PROXY_PORT"
  echo "export MATRIX_COORDINATOR_PORT=$MATRIX_COORDINATOR_PORT"
  echo "export MATRIX_MLX_PYTHON=$MLX_PY"
fi

echo "MODELS:     =${MODEL_DIR}"
echo "LLAMA_SERVER=${MATRIX_LLAMA_SERVER}"

# EOF
