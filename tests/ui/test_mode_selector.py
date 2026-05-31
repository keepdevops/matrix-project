"""Static tests for mode selector descriptions and manifest completeness (MS-29-4)."""
from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

PYTHON_MODES = ["map_reduce", "speculative", "critic_debate", "tree_of_thought"]
CPP_MODES    = ["flat", "pipeline", "cascade", "router"]
ALL_MODES    = CPP_MODES + PYTHON_MODES


def _manifest_data():
    return (REPO / "src/utils/modeManifestData.js").read_text()


def _manifest_js():
    return (REPO / "src/utils/modeManifest.js").read_text()


def _mode_selector():
    return (REPO / "src/components/ModeSelector.js").read_text()


def test_all_eight_modes_in_manifest():
    data = _manifest_data()
    for mode in ALL_MODES:
        assert mode in data, f"Mode '{mode}' missing from modeManifestData.js"


def test_all_modes_have_description():
    data = _manifest_data()
    for mode in ALL_MODES:
        # description field must appear after the mode key and before the next closing brace
        idx = data.find(mode + ":")
        assert idx != -1, f"Mode '{mode}' not found"
        block = data[idx:idx + 300]
        assert "description:" in block, f"Mode '{mode}' missing description field"


def test_python_modes_marked_python_backend():
    data = _manifest_data()
    for mode in PYTHON_MODES:
        idx = data.find(mode + ":")
        block = data[idx:idx + 200]
        assert "backend: 'python'" in block, f"Mode '{mode}' not marked as python backend"


def test_cpp_modes_marked_cpp_backend_or_default():
    data = _manifest_data()
    for mode in CPP_MODES:
        idx = data.find(mode + ":")
        block = data[idx:idx + 200]
        assert "backend: 'cpp'" in block, f"Mode '{mode}' not marked as cpp backend"


def test_python_modes_all_enabled_and_ui_true():
    data = _manifest_data()
    for mode in PYTHON_MODES:
        idx = data.find(mode + ":")
        block = data[idx:idx + 300]
        assert "enabled: true" in block, f"Mode '{mode}' not enabled"
        assert "ui: true" in block, f"Mode '{mode}' ui not true"


def test_manifest_js_exposes_description():
    src = _manifest_js()
    assert "description" in src, "applyModeManifest does not expose description field"


def test_mode_selector_uses_mode_option_desc_class():
    src = _mode_selector()
    assert "mode-option-desc" in src, "ModeSelector does not use .mode-option-desc class"
    # Ensure the old wrong class name is not used
    assert "mode-option-description" not in src, \
        "ModeSelector still references unstyled .mode-option-description class"


def test_mode_selector_renders_description():
    src = _mode_selector()
    assert "m.description" in src, "ModeSelector does not render m.description"


def test_mode_option_desc_styled_in_app_css():
    css = (REPO / "src/App.css").read_text()
    assert ".mode-option-desc" in css, ".mode-option-desc rule missing from App.css"
