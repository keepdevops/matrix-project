#!/bin/bash
# Wrapper for the integration test suite. Builds the coordinator if missing,
# then runs pytest with sensible defaults.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -x ./coordinator ]; then
  echo "==> coordinator binary missing — building"
  npm run build:bin
fi

# Stop any dev coordinator running on the test port (18000) before kicking off.
# Port 8000 (the dev one) is left alone.
lsof -tiTCP:18000 -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true

exec python3 -m pytest tests/ -v "$@"
