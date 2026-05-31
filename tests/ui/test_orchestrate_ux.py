"""Static tests for orchestrate UX components introduced in MS-26–MS-29 (MS-29-4)."""
from __future__ import annotations

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


# ── ConversationThread — orchestrate mode badge ──────────────────────────────

def test_conversation_thread_renders_orchestrate_badge():
    src = (REPO / "src/components/ConversationThread.js").read_text()
    assert "_orchestrate" in src, "Turn does not check entry._orchestrate"
    assert "ct-mode-badge" in src, "Turn does not render .ct-mode-badge"
    assert "🐍" in src, "Mode badge missing Python snake emoji"


def test_conversation_thread_shows_mode_name_in_badge():
    src = (REPO / "src/components/ConversationThread.js").read_text()
    assert "entry._mode" in src, "Turn does not use entry._mode for badge label"


# ── useSwarm — orchestrate history persistence ───────────────────────────────

def test_use_swarm_saves_orchestrate_history():
    src = (REPO / "src/hooks/useSwarm.js").read_text()
    assert "saveOrchestrateHistory" in src, \
        "useSwarm.js does not call saveOrchestrateHistory after orchestrate onDone"


def test_orchestrate_api_exports_save_history():
    src = (REPO / "src/api/orchestrateApi.js").read_text()
    assert "saveOrchestrateHistory" in src, \
        "orchestrateApi.js does not export saveOrchestrateHistory"
    assert "/api/history/entry" in src, \
        "saveOrchestrateHistory does not POST to /api/history/entry"


# ── BrewlateLayout — orchestrate progress indicator ──────────────────────────

def test_brewlate_shows_orchestrate_phase_progress():
    src = (REPO / "src/layouts/BrewlateLayout.js").read_text()
    assert "brew-brewcast-phase" in src, \
        "BrewlateLayout does not render .brew-brewcast-phase progress indicator"
    assert "_phase" in src, \
        "BrewlateLayout does not read lastMeta._phase for progress"


def test_brewlate_phase_shows_depth_and_round():
    src = (REPO / "src/layouts/BrewlateLayout.js").read_text()
    assert "depth" in src, "Progress indicator does not show depth (tree_of_thought)"
    assert "round" in src, "Progress indicator does not show round (critic_debate)"


# ── RAG citation panel ───────────────────────────────────────────────────────

def test_brewlate_wires_rag_sources_to_last_meta():
    src = (REPO / "src/layouts/BrewlateLayout.js").read_text()
    assert "lastMeta?.rag" in src or "lastMeta.rag" in src, \
        "BrewlateLayout does not pass lastMeta.rag to RagSources"


def test_default_layout_wires_rag_sources_to_last_meta():
    src = (REPO / "src/layouts/DefaultLayout.js").read_text()
    assert "lastMeta?.rag" in src or "lastMeta.rag" in src, \
        "DefaultLayout does not pass lastMeta.rag to RagSources"


def test_use_swarm_builds_rag_meta_from_done_event():
    src = (REPO / "src/hooks/useSwarm.js").read_text()
    assert "rag_chunks" in src, \
        "useSwarm.js does not convert rag_chunks from done event into lastMeta.rag"
    assert "ragMeta" in src, \
        "useSwarm.js does not construct ragMeta for lastMeta"


# ── Orchestrate metrics ───────────────────────────────────────────────────────

def test_metrics_strip_accepts_orchestrate_timings():
    src = (REPO / "src/components/MetricsStrip.js").read_text()
    assert "meta.timings" in src or "timings" in src, \
        "MetricsStrip does not read meta.timings"
    assert "completion_tokens" in src, \
        "MetricsStrip does not render completion_tokens"


def test_use_swarm_merges_timings_from_done_event():
    src = (REPO / "src/hooks/useSwarm.js").read_text()
    assert "timings" in src, \
        "useSwarm.js does not merge timings from orchestrate done event into lastMeta"
