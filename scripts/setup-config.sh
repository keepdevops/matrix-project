#!/usr/bin/env bash
# MS-68/MS-69: copy swarm-config.template.json → swarm-config.json when missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="${ROOT}/swarm-config.template.json"
TARGET="${ROOT}/swarm-config.json"

if [[ ! -f "$TEMPLATE" ]]; then
  echo "❌ Missing template: $TEMPLATE" >&2
  exit 1
fi
if [[ -f "$TARGET" ]]; then
  echo "✅ $TARGET already exists (unchanged)"
  exit 0
fi
cp "$TEMPLATE" "$TARGET"
echo "✅ Created $TARGET from swarm-config.template.json"
echo "   Edit agents/coordinator, or run: python3 scripts/build_swarm_config.py"
