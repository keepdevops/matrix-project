#!/bin/bash
# Stages the publishable dist/ tree before `npm pack` / `npm publish`.
# Binaries are NOT staged here — they are downloaded by postinstall from the
# matching GitHub Release. This script only stages the web build + configs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"

if [[ ! -d "$ROOT/build" ]]; then
  echo "[stage-dist] $ROOT/build missing — run 'npm run build' first" >&2
  exit 1
fi

rm -rf "$DIST/web" "$DIST/config"
mkdir -p "$DIST/web" "$DIST/config"

cp -R "$ROOT/build"/* "$DIST/web/"

cp "$ROOT/swarm-config.json"                    "$DIST/config/default.json"
cp "$ROOT/swarm-config-16gb.json"               "$DIST/config/16gb.json"
cp "$ROOT/swarm-config-32gb.json"               "$DIST/config/32gb.json"
cp "$ROOT/swarm-config-8agents-text-image.json" "$DIST/config/8agents.json"

echo "[stage-dist] staged web + configs into $DIST"
