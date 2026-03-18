#!/bin/bash
# fan_control.sh — Macs Fan Control integration for Matrix GPU swarm
# Controls Left Side Fan and Right Side Fan based on GPU cluster average
# Temp range: 28°C (spin-up) → 36°C (max speed) — Sensor-Based mode
#
# Usage:
#   fan_control.sh start   — GPU cluster sensor-based control (28–36°C)
#   fan_control.sh stop    — Restore system Auto fan control
#   fan_control.sh status  — Show active preset

MFC_PLIST="$HOME/Library/Preferences/com.crystalidea.macsfancontrol.plist"
MFC_BUNDLE="com.crystalidea.macsfancontrol"
MFC_APP="/Applications/Macs Fan Control.app"

# Sensor-Based mode (2) | gpu_clusters_average | 28°C min | 36°C max
FAN_CFG="2,gpu_clusters_average,28,36"
GPU_PRESET_RAW="UNSAVED|${FAN_CFG}|${FAN_CFG}"
AUTO_PRESET_RAW="Predefined:0"

# ── Helpers ──────────────────────────────────────────────────────────────────

_mfc_running() {
    pgrep -x "Macs Fan Control" 
}

_kill_mfc() {
    local pid
    pid=$(pgrep -x "Macs Fan Control" )
    if [ -n "$pid" ]; then
        # Force-kill so MFC cannot write its in-memory state over our changes
        kill -9 "$pid" 
        sleep 1
    fi
}

_write_preset() {
    local value="$1"
    # Write directly to the plist file (bypasses cfprefsd cache)
    /usr/libexec/PlistBuddy -c "Set :ActivePreset $value" "$MFC_PLIST" \
        || /usr/libexec/PlistBuddy -c "Add :ActivePreset string $value" "$MFC_PLIST" 
    # Flush cfprefsd so defaults domain reflects the change
    killall -HUP cfprefsd 
    sleep 0.5
}

_open_mfc() {
    open -a "$MFC_APP" --background
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_start() {
    local preset_b64
    preset_b64=$(echo -n "$GPU_PRESET_RAW" | base64)

    _kill_mfc
    _write_preset "$preset_b64"
    _open_mfc

    echo "[Fan] GPU cluster sensor-based control active — Left + Right fans | 28–36°C"
}

cmd_stop() {
    _kill_mfc
    _write_preset "$AUTO_PRESET_RAW"
    _open_mfc

    echo "[Fan] Restored to system Auto"
}

cmd_status() {
    local raw
    raw=$(/usr/libexec/PlistBuddy -c "Print :ActivePreset" "$MFC_PLIST" )
    if [ -z "$raw" ]; then
        echo "[Fan] No active preset found in plist"
        return
    fi
    # Try to Base64-decode; if it fails it's a plain string (e.g. Predefined:0)
    local decoded
    decoded=$(echo "$raw" | base64 -d )
    if echo "$decoded" | grep -q "|"; then
        echo "[Fan] Active: $decoded"
    else
        echo "[Fan] Active: $raw"
    fi
}

# ── Entry ─────────────────────────────────────────────────────────────────────

case "${1:-}" in
    start)  cmd_start  ;;
    stop)   cmd_stop   ;;
    status) cmd_status ;;
    *)
        echo "Usage: $(basename "$0") {start|stop|status}"
        echo "  start  — GPU cluster sensor-based (28–36°C, Left + Right fans)"
        echo "  stop   — Restore system Auto fan control"
        echo "  status — Show current active preset"
        exit 1
        ;;
esac
