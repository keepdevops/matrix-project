#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
EDITOR_PATH="${REPO_ROOT}/tools/swarmconfig-editor.html"

if [[ ! -f "${EDITOR_PATH}" ]]; then
  echo "Standalone editor not found at: ${EDITOR_PATH}" >&2
  exit 1
fi

if command -v open >/dev/null 2>&1; then
  open "${EDITOR_PATH}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${EDITOR_PATH}"
else
  echo "No supported opener found. Open this file manually:" >&2
  echo "${EDITOR_PATH}" >&2
  exit 1
fi

echo "Opened ${EDITOR_PATH}"
