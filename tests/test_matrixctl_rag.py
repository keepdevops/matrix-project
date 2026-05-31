"""Tests for RAG helper functions in scripts/matrixctl.

Covers _pick_embedder(), _index() file discovery/filtering, _query()
formatting, and _sources() display. All store/embedder I/O is mocked.

These are unit tests — no pgvector or real embedding calls.
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import importlib.util

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

if not (SCRIPTS / "matrixctl").is_file():
    pytest.skip("scripts/matrixctl removed — see tests/test_brewctl_rag.py", allow_module_level=True)

# matrixctl has no .py extension; load it by file path.
# Stub heavy orchestration imports before the module executes.
_stub_rag = MagicMock()
_stub_rag.chunk_text = MagicMock(return_value=[])
_stub_rag.retrieve = AsyncMock(return_value=[])
_stub_embed = MagicMock()
_stub_embed.HashEmbedder = MagicMock
_stub_embed.MLXEmbedder = MagicMock
_stub_store = MagicMock()
_stub_store.PgVectorStore = MagicMock
_stub_store.UpsertRow = MagicMock
_stub_lifecycle = MagicMock()

from importlib.machinery import SourceFileLoader

with patch.dict(sys.modules, {
    "orchestration": MagicMock(),
    "orchestration.rag": _stub_rag,
    "orchestration.rag.embed": _stub_embed,
    "orchestration.rag.store": _stub_store,
    "orchestration.lifecycle": _stub_lifecycle,
}):
    _loader = SourceFileLoader("matrixctl", str(SCRIPTS / "matrixctl"))
    _spec = importlib.util.spec_from_loader("matrixctl", _loader)
    matrixctl = importlib.util.module_from_spec(_spec)
    sys.modules["matrixctl"] = matrixctl
    _loader.exec_module(matrixctl)


# ---------------------------------------------------------------------------
# _pick_embedder
# ---------------------------------------------------------------------------

def test_pick_embedder_hash_returns_hash_instance():
    fake_hash = MagicMock()
    with patch.object(matrixctl, "HashEmbedder", return_value=fake_hash):
        result = matrixctl._pick_embedder("hash")
    assert result is fake_hash


def test_pick_embedder_mlx_returns_mlx_instance():
    fake_mlx = MagicMock()
    with patch.object(matrixctl, "MLXEmbedder", return_value=fake_mlx):
        result = matrixctl._pick_embedder("mlx")
    assert result is fake_mlx


def test_pick_embedder_unknown_raises_value_error():
    with pytest.raises(ValueError, match="unknown embedder"):
        matrixctl._pick_embedder("openai")


# ---------------------------------------------------------------------------
# _index — file discovery and filtering
# ---------------------------------------------------------------------------

def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_index_includes_python_files(tmp_path):
    (tmp_path / "main.py").write_text("print('hello')")
    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=0)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[[0.1] * 4])

    chunk = MagicMock()
    chunk.content = "x"
    chunk.source_path = str(tmp_path / "main.py")
    chunk.chunk_idx = 0
    chunk.metadata = {}

    with patch.object(matrixctl, "chunk_text", return_value=[chunk]):
        _run(matrixctl._index(tmp_path, embedder, store))

    embedder.embed.assert_awaited()


def test_index_skips_node_modules(tmp_path):
    nm = tmp_path / "node_modules" / "pkg"
    nm.mkdir(parents=True)
    (nm / "index.js").write_text("module.exports = {}")

    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=0)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[])

    with patch.object(matrixctl, "chunk_text", return_value=[]) as mock_chunk:
        _run(matrixctl._index(tmp_path, embedder, store))

    mock_chunk.assert_not_called()


def test_index_skips_build_directory(tmp_path):
    build = tmp_path / "build"
    build.mkdir()
    (build / "output.js").write_text("// compiled")

    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=0)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[])

    with patch.object(matrixctl, "chunk_text", return_value=[]) as mock_chunk:
        _run(matrixctl._index(tmp_path, embedder, store))

    mock_chunk.assert_not_called()


def test_index_skips_non_indexable_extension(tmp_path):
    (tmp_path / "binary.exe").write_bytes(b"\x00\x01\x02")
    (tmp_path / "data.csv").write_text("a,b,c")

    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=0)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[])

    with patch.object(matrixctl, "chunk_text", return_value=[]) as mock_chunk:
        _run(matrixctl._index(tmp_path, embedder, store))

    mock_chunk.assert_not_called()


def test_index_continues_on_read_error(tmp_path):
    # _index must log and skip unreadable files rather than aborting.
    (tmp_path / "good.py").write_text("x = 1")
    (tmp_path / "bad.py").write_text("y = 2")
    bad_path = tmp_path / "bad.py"

    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=0)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[])

    original_read = Path.read_text

    def selective_read(self, **kwargs):
        if self == bad_path:
            raise OSError("permission denied")
        return original_read(self, **kwargs)

    with patch.object(matrixctl, "chunk_text", return_value=[]), \
         patch("pathlib.Path.read_text", selective_read):
        # Must not raise even though one file fails to read.
        total = _run(matrixctl._index(tmp_path, embedder, store))

    assert isinstance(total, int)


def test_index_returns_total_upserted(tmp_path):
    (tmp_path / "a.py").write_text("x = 1")

    store = MagicMock()
    store.upsert_chunks = AsyncMock(return_value=7)
    embedder = MagicMock()
    embedder.embed = AsyncMock(return_value=[[0.0] * 4])

    chunk = MagicMock()
    chunk.content = "x = 1"
    chunk.source_path = str(tmp_path / "a.py")
    chunk.chunk_idx = 0
    chunk.metadata = {}

    with patch.object(matrixctl, "chunk_text", return_value=[chunk]):
        total = _run(matrixctl._index(tmp_path, embedder, store))

    assert total == 7


# ---------------------------------------------------------------------------
# _query — output formatting
# ---------------------------------------------------------------------------

def test_query_prints_hits(capsys):
    hit = MagicMock()
    hit.distance = 0.1234
    hit.source_path = "src/foo.py"
    hit.content = "def hello(): pass"

    mock_retrieve = AsyncMock(return_value=[hit])
    store = MagicMock()
    embedder = MagicMock()

    with patch.object(matrixctl, "retrieve", mock_retrieve):
        _run(matrixctl._query("hello", 3, embedder, store))

    out = capsys.readouterr().out
    assert "#0" in out
    assert "0.1234" in out
    assert "src/foo.py" in out
    assert "def hello" in out


def test_query_truncates_long_content(capsys):
    hit = MagicMock()
    hit.distance = 0.5
    hit.source_path = "x.py"
    hit.content = "a" * 300  # longer than 200

    with patch.object(matrixctl, "retrieve", AsyncMock(return_value=[hit])):
        _run(matrixctl._query("a", 1, MagicMock(), MagicMock()))

    out = capsys.readouterr().out
    assert "..." in out


def test_query_no_hits_prints_nothing(capsys):
    with patch.object(matrixctl, "retrieve", AsyncMock(return_value=[])):
        _run(matrixctl._query("nothing", 5, MagicMock(), MagicMock()))

    assert capsys.readouterr().out == ""


# ---------------------------------------------------------------------------
# _sources — display
# ---------------------------------------------------------------------------

def test_sources_empty_prints_message(capsys):
    store = MagicMock()
    store.list_sources = AsyncMock(return_value=[])
    _run(matrixctl._sources(store))
    assert "no sources" in capsys.readouterr().out.lower()


def test_sources_prints_header_and_rows(capsys):
    store = MagicMock()
    store.list_sources = AsyncMock(return_value=[
        {"chunks": 12, "latest": "2026-05-30T10:00:00", "source_path": "src/foo.py"},
    ])
    _run(matrixctl._sources(store))
    out = capsys.readouterr().out
    assert "CHUNKS" in out
    assert "src/foo.py" in out
    assert "12" in out


def test_sources_handles_null_latest(capsys):
    store = MagicMock()
    store.list_sources = AsyncMock(return_value=[
        {"chunks": 3, "latest": None, "source_path": "old/file.md"},
    ])
    _run(matrixctl._sources(store))
    out = capsys.readouterr().out
    assert "-" in out  # null timestamp renders as dash
