"""Tests for orchestration.modes._helpers.rag_xml."""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from orchestration.modes._helpers import rag_xml  # noqa: E402


def test_rag_xml_empty_returns_empty_string():
    assert rag_xml([]) == ""


def test_rag_xml_formats_chunks_with_path_and_distance():
    chunks = [
        {"source_path": "docs/a.md", "distance": 0.1234, "content": "alpha"},
        {"source_path": "docs/b.md", "distance": 0.5, "content": "beta"},
    ]
    out = rag_xml(chunks)
    assert out.startswith("<retrieved>\n")
    assert out.endswith("</retrieved>\n")
    assert "path='docs/a.md'" in out
    assert "distance=0.1234" in out
    assert "alpha" in out
    assert "beta" in out


def test_rag_xml_missing_fields_use_defaults():
    out = rag_xml([{"content": "bare"}])
    assert "path='?'" in out
    assert "distance=0.0000" in out
    assert "bare" in out
