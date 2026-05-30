#!/usr/bin/env bash
# run-tests.sh — run all available tests grouped by feature area.
#
# Usage:
#   bash scripts/run-tests.sh              # run every group
#   bash scripts/run-tests.sh modes chaos  # run specific groups only
#
# Groups: modes ux chaos buttons roles_roster role_profiles gguf_models mlx_models

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# ── colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

pass() { printf "${GREEN}✔  %s${RESET}\n" "$*"; }
fail() { printf "${RED}✖  %s${RESET}\n" "$*"; }
skip() { printf "${YELLOW}–  %s${RESET}\n" "$*"; }
header() { printf "\n${BOLD}${CYAN}══  %s  ══${RESET}\n" "$*"; }

# ── state tracking ────────────────────────────────────────────────────────────
GROUPS_RUN=0
GROUPS_PASSED=0
GROUPS_SKIPPED=0
GROUPS_FAILED=0
FAILED_GROUPS=()

run_group() {
    local name="$1"; shift
    local files=("$@")
    GROUPS_RUN=$((GROUPS_RUN + 1))

    header "$name"

    # Collect only files that actually exist.
    local existing=()
    for f in "${files[@]}"; do
        [[ -e "$REPO/$f" ]] && existing+=("$f")
    done

    if [[ ${#existing[@]} -eq 0 ]]; then
        skip "No tests found for '$name'"
        GROUPS_SKIPPED=$((GROUPS_SKIPPED + 1))
        return
    fi

    printf "  Files: %s\n" "${existing[*]}"
    echo ""

    if python3 -m pytest "${existing[@]}" -v --tb=short 2>&1; then
        pass "$name — all tests passed"
        GROUPS_PASSED=$((GROUPS_PASSED + 1))
    else
        fail "$name — some tests FAILED"
        GROUPS_FAILED=$((GROUPS_FAILED + 1))
        FAILED_GROUPS+=("$name")
    fi
}

# ── group definitions ─────────────────────────────────────────────────────────

do_modes() {
    run_group "Modes" \
        tests/test_modes.py \
        tests/test_streaming.py \
        tests/test_resilience.py \
        tests/modes/test_registry.py \
        tests/modes/test_rag_injection.py \
        tests/rag/test_rag.py \
        tests/rag/test_rag_doc.py \
        tests/rag/test_embed_endpoint.py
}

do_ux() {
    # No dedicated UX/browser tests exist yet; closest coverage is the
    # system-prompt editing and presets flows that back the UI panels.
    run_group "UX (system-prompt editing + presets)" \
        tests/test_prompts.py \
        tests/test_presets.py
}

do_chaos() {
    run_group "Chaos" \
        tests/test_chaos.py \
        tests/mlx_coordinator/test_chaos.py
}

do_buttons() {
    # Brewlate header/configure/runtime button smoke tests (Playwright + dev server).
    run_group "Buttons" \
        tests/ui/test_buttons.py
}

do_roles_roster() {
    # Roster config, per-mode agent lists, circuit-breaker exclusions,
    # multi-instance launch guard (prevents two swarms clobbering each other).
    run_group "Roles / Roster" \
        tests/test_modes.py \
        tests/test_breaker.py \
        tests/test_kv_pressure.py \
        tests/test_multi_instance_guard.py
}

do_role_profiles() {
    # Agent role definitions — build-time config generation, migration,
    # live prompt edits, matrixctl RAG helpers.
    run_group "Role Profiles" \
        tests/test_build_swarm_config.py \
        tests/test_migrate_swarm_config.py \
        tests/test_prompts.py \
        tests/test_matrixctl_rag.py
}

do_gguf_models() {
    # gguf_to_mlx conversion script tests (argument parsing, emit format,
    # mlx_lm import failure, convert() invocation).
    # Full model-load / quantisation tests would require tests/cpp/test_gguf.py.
    run_group "GGUF Models" \
        tests/test_gguf_to_mlx.py \
        tests/cpp/test_gguf.py
}

do_mlx_models() {
    run_group "MLX Models" \
        tests/mlx_coordinator/test_backend.py \
        tests/mlx_coordinator/test_backend_advanced.py \
        tests/mlx_coordinator/test_generate_multi_prompt.py \
        tests/mlx_coordinator/test_service.py \
        tests/mlx_coordinator/test_service_advanced.py \
        tests/mlx_coordinator/test_session.py \
        tests/mlx_coordinator/test_session_advanced.py
}

# ── dispatch ──────────────────────────────────────────────────────────────────

ALL_GROUPS=(modes ux chaos buttons roles_roster role_profiles gguf_models mlx_models)

# If arguments supplied, run only those groups; otherwise run all.
REQUESTED=("${@:-${ALL_GROUPS[@]}}")

for group in "${REQUESTED[@]}"; do
    case "$group" in
        modes)          do_modes ;;
        ux)             do_ux ;;
        chaos)          do_chaos ;;
        buttons)        do_buttons ;;
        roles_roster)   do_roles_roster ;;
        role_profiles)  do_role_profiles ;;
        gguf_models)    do_gguf_models ;;
        mlx_models)     do_mlx_models ;;
        *)
            printf "${RED}Unknown group '%s'. Valid groups: %s${RESET}\n" \
                "$group" "${ALL_GROUPS[*]}"
            exit 1
            ;;
    esac
done

# ── summary ───────────────────────────────────────────────────────────────────

echo ""
printf "${BOLD}══════════════════════════════════════════${RESET}\n"
printf "${BOLD}  Test run summary${RESET}\n"
printf "${BOLD}══════════════════════════════════════════${RESET}\n"
printf "  Groups run    : %d\n" "$GROUPS_RUN"
printf "  ${GREEN}Passed${RESET}        : %d\n" "$GROUPS_PASSED"
printf "  ${YELLOW}Skipped/missing${RESET}: %d\n" "$GROUPS_SKIPPED"
printf "  ${RED}Failed${RESET}        : %d\n" "$GROUPS_FAILED"

if [[ ${#FAILED_GROUPS[@]} -gt 0 ]]; then
    printf "\n  ${RED}Failed groups:${RESET}\n"
    for g in "${FAILED_GROUPS[@]}"; do
        printf "    ${RED}• %s${RESET}\n" "$g"
    done
    echo ""
    exit 1
fi

if [[ $GROUPS_FAILED -eq 0 && $GROUPS_PASSED -gt 0 ]]; then
    printf "\n  ${GREEN}${BOLD}All available tests passed.${RESET}\n\n"
fi
