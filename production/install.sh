#!/usr/bin/env bash
# Production install: C++ binaries + npm deps; optional Docker UI image.
# Run from anywhere:  bash production/install.sh
# Repository root is detected automatically.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/scripts/matrix-env.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/scripts/matrix-env.sh"
fi

echo "==> Matrix Swarm — production install (root: $ROOT)"
echo

echo "==> Build coordinator + proxy (C++)"
bash "$ROOT/scripts/build_coordinator.sh"
echo

echo "==> npm ci (lockfile-aligned UI deps)"
npm ci
echo

if [[ "${1:-}" == "--with-docker" ]] || [[ "${MATRIX_PROD_DOCKER:-}" == "1" ]]; then
  echo "==> Docker: production UI image (nginx + static build)"
  docker compose -f "$ROOT/production/docker-compose.prod.yml" build
  echo
  echo "  Start UI:  docker compose -f production/docker-compose.prod.yml up -d"
else
  echo "  (Skip Docker UI image. To build it:  bash production/install.sh --with-docker"
  echo "   or:  MATRIX_PROD_DOCKER=1 bash production/install.sh)"
fi

echo
echo "==> Next (host inference)"
echo "    Optional:  bash scripts/matrix-validate-env.sh"
echo "    Run proxy:   ./proxy >> logs/proxy.log 2>&1 &"
echo "    Full notes:  production/README.md"
