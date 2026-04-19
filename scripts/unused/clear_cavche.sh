#!/usr/bin/env bash
# Clear KV cache on all llama-server agents via the coordinator API.
# If the coordinator is not running, falls back to restarting the llama-server
# processes (which fully releases VRAM).
#
# Usage:
#   bash scripts/clear_cache.sh           # soft clear (KV cache only)
#   bash scripts/clear_cache.sh --hard    # hard clear (kill + restart agents, frees VRAM)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/matrix-env.sh"

COORDINATOR_URL="http://localhost:${MATRIX_COORDINATOR_PORT:-8000}"
HARD=false
[[ "${1:-}" == "--hard" ]] && HARD=true

# ── soft clear: hit coordinator /api/clear-cache ──────────────────────────────
soft_clear() {
    echo "[cache] Sending KV cache clear to coordinator..."
    HTTP_CODE=$(curl -s -o /tmp/matrix_cache_resp.json -w "%{http_code}" \
        -X POST "${COORDINATOR_URL}/api/clear-cache")
    if [[ "$HTTP_CODE" == "200" ]]; then
        echo "  -> OK: $(cat /tmp/matrix_cache_resp.json)"
    else
        echo "  [error] coordinator returned HTTP ${HTTP_CODE}"
        cat /tmp/matrix_cache_resp.json 2>/dev/null || true
        exit 1
    fi
}

# ── hard clear: kill llama-server processes to free VRAM ─────────────────────
hard_clear() {
    echo "[vram] Killing all llama-server processes to release VRAM..."
    pkill -f llama-server 2>/dev/null && echo "  -> llama-server processes stopped" || echo "  -> none running"
    sleep 1
    REMAINING=$(pgrep -f llama-server 2>/dev/null || true)
    if [[ -n "$REMAINING" ]]; then
        echo "  [warn] force-killing remaining PIDs: $REMAINING"
        pkill -9 -f llama-server 2>/dev/null || true
    fi
    echo "  -> VRAM released. Restart agents via the UI or swarm script."
}

if $HARD; then
    hard_clear
else
    # Try soft clear; if coordinator is unreachable, report clearly
    if ! curl -sf --max-time 2 "${COORDINATOR_URL}/api/clear-cache" -o /dev/null -X POST 2>/dev/null; then
        echo "  [warn] coordinator not reachable at ${COORDINATOR_URL}"
        echo "         Run with --hard to kill agents and free VRAM, or start the coordinator first."
        exit 1
    fi
    soft_clear
fi
