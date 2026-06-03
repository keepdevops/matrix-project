#!/usr/bin/env bash
# MS-131 — verify docs/mlx-native-api-parity.md contains required sections.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOC="$ROOT/docs/mlx-native-api-parity.md"

if [[ ! -f "$DOC" ]]; then
  echo "❌ Missing $DOC" >&2
  exit 1
fi

REQUIRED=(
  "## 1. Route inventory"
  "## 2. Multi-platform memory"
  "## 3. HTTP error code matrix"
  "## 4. Capability mapping"
  "## 5. Request / response schemas"
  "## 6. Orchestrate sidecar routing"
  "Mode mapping"
  "## 7. Serialization"
  "## 8. Environment variables"
  "## 9. Test parity map"
  "Metal (macOS)"
  "CUDA (Linux)"
  "CPU (Linux fallback)"
  "/api/mlx/stream"
  "/api/mlx/submit"
  "/api/mlx/health"
  "429"
  "503"
)

missing=0
for needle in "${REQUIRED[@]}"; do
  if ! grep -qF "$needle" "$DOC"; then
    echo "❌ parity doc missing required section/token: $needle" >&2
    missing=$((missing + 1))
  fi
done

if [[ "$missing" -gt 0 ]]; then
  echo "❌ validate_mlx_parity_schema: $missing check(s) failed" >&2
  exit 1
fi

echo "✅ mlx-native-api-parity.md schema OK ($DOC)"
exit 0
