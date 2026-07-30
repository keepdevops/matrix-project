"""RAG documentation tests — verifies every behavior described in CAPABILITIES.md §13.

Each test cites the documented claim it exercises. No Postgres or MLX required.

Sections covered:
  - chunk_text: all splitters (Python, C++, TypeScript/JS, window fallback)
  - HashEmbedder: dimensionality, determinism, unit-norm, empty input
  - retrieve(): empty-query guard, field contract, k limit, distance ordering
  - Hash embedder distance properties (CAPABILITIES.md min_score note)
"""
from __future__ import annotations

import asyncio
import math
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from orchestration.rag import chunk_text, retrieve  # noqa: E402
from orchestration.rag.chunker import (  # noqa: E402
    DEFAULT_MAX_CHARS, DEFAULT_OVERLAP, DEFAULT_WINDOW, _chunk_window,
)
from orchestration.rag.embed import EMBED_DIM, HashEmbedder  # noqa: E402
from orchestration.rag.retrieve import RetrievedChunk  # noqa: E402
from orchestration.rag.store import SearchHit, UpsertRow  # noqa: E402

sys.path.insert(0, str(REPO / "tests" / "rag"))
from test_rag import InMemoryStore  # noqa: E402


# ---------------------------------------------------------------------------
# Chunker — Python splitter
# ---------------------------------------------------------------------------
# CAPABILITIES.md: "Walk path, chunk, embed, upsert into pgvector."
# chunker.py: dispatches on extension; .py → AST splitter.

def test_python_async_function_is_chunked():
    # async def must be treated the same as def.
    src = "async def fetch(url):\n    return url\n"
    chunks = chunk_text("a.py", src)
    assert len(chunks) == 1
    assert chunks[0].metadata["name"] == "fetch"
    assert chunks[0].metadata["kind"] == "AsyncFunctionDef"


def test_python_class_method_not_double_counted():
    # Only top-level nodes are extracted; methods inside a class are not
    # promoted to top-level chunks.
    src = "class Foo:\n    def bar(self): pass\n"
    chunks = chunk_text("a.py", src)
    names = [c.metadata["name"] for c in chunks]
    assert "Foo" in names
    assert "bar" not in names


def test_python_chunk_metadata_fields():
    src = "def greet(name):\n    print(name)\n"
    chunks = chunk_text("src/hello.py", src)
    assert len(chunks) == 1
    m = chunks[0].metadata
    assert m["lang"] == "python"
    assert m["kind"] == "FunctionDef"
    assert m["name"] == "greet"
    assert m["lineno"] == 1
    assert chunks[0].source_path == "src/hello.py"


def test_python_module_level_only_falls_back_to_window():
    # A file with only module-level statements (no functions/classes)
    # must fall back to the sliding-window chunker.
    src = "\n".join(f"x_{i} = {i}" for i in range(100))
    chunks = chunk_text("constants.py", src)
    assert len(chunks) > 1
    assert all(c.metadata["lang"] == "text" for c in chunks)


def test_python_syntax_error_falls_back_to_window():
    # chunker.py line 41-42: SyntaxError → log + window fallback.
    src = "def broken(\n    pass\n"  # malformed
    chunks = chunk_text("bad.py", src)
    assert chunks  # didn't raise, fell back
    assert all(c.metadata["lang"] == "text" for c in chunks)


def test_python_chunk_indices_are_sequential():
    src = "def a(): pass\ndef b(): pass\ndef c(): pass\n"
    chunks = chunk_text("x.py", src)
    assert [c.chunk_idx for c in chunks] == list(range(len(chunks)))


# ---------------------------------------------------------------------------
# Chunker — C++ splitter
# ---------------------------------------------------------------------------

def test_cpp_no_functions_falls_back_to_window():
    # C++ header with only declarations (no brace bodies).
    src = "#pragma once\nclass Foo;\nextern int bar;\n"
    chunks = chunk_text("header.h", src)
    assert chunks
    assert all(c.metadata["lang"] == "text" for c in chunks)


def test_cpp_chunk_metadata_has_name():
    src = "void hello() {\n    printf(\"hi\");\n}\n"
    chunks = chunk_text("main.cpp", src)
    assert any(c.metadata.get("name") == "hello" for c in chunks)
    assert all(c.metadata["lang"] == "cpp" for c in chunks)


def test_cpp_extension_variants_all_dispatched():
    # .cc, .cxx, .h, .hpp, .c must all go through the C++ path.
    src = "int noop() { return 0; }\n"
    for ext in [".cc", ".cxx", ".h", ".hpp", ".c"]:
        chunks = chunk_text(f"file{ext}", src)
        assert any(c.metadata.get("lang") == "cpp" for c in chunks), ext


# ---------------------------------------------------------------------------
# Chunker — TypeScript / JavaScript brace splitter
# ---------------------------------------------------------------------------

def test_typescript_function_chunked():
    src = "function greet(name: string): void {\n    console.log(name);\n}\n"
    chunks = chunk_text("app.ts", src)
    assert any(c.metadata.get("name") == "greet" for c in chunks)
    assert all(c.metadata["lang"] == "ts" for c in chunks)


def test_javascript_class_chunked():
    src = "class Router {\n    route(path) { return path; }\n}\n"
    chunks = chunk_text("router.js", src)
    assert any(c.metadata.get("name") == "Router" for c in chunks)


def test_tsx_extension_dispatched_to_brace_splitter():
    src = "export function Button() {\n    return null;\n}\n"
    chunks = chunk_text("btn.tsx", src)
    assert any(c.metadata.get("name") == "Button" for c in chunks)
    assert all(c.metadata["lang"] == "tsx" for c in chunks)


def test_js_no_functions_falls_back_to_window():
    src = "const X = 1;\nconst Y = 2;\n"
    chunks = chunk_text("consts.js", src)
    assert chunks
    assert all(c.metadata["lang"] == "text" for c in chunks)


# ---------------------------------------------------------------------------
# Chunker — sliding-window fallback
# ---------------------------------------------------------------------------

def test_window_empty_text_returns_empty():
    # chunker.py line 154: empty lines → [].
    assert chunk_text("notes.txt", "") == []
    assert _chunk_window("notes.txt", "") == []


def test_window_single_line():
    chunks = chunk_text("single.txt", "only one line")
    assert len(chunks) == 1
    assert chunks[0].content == "only one line"


def test_window_metadata_fields():
    # Documented metadata for window chunks: lang=text, line_start, line_end.
    text = "\n".join(f"line {i}" for i in range(10))
    chunks = chunk_text("readme.txt", text)
    for c in chunks:
        assert c.metadata["lang"] == "text"
        assert "line_start" in c.metadata
        assert "line_end" in c.metadata


def test_window_overlap_creates_shared_lines():
    # With default overlap, consecutive chunks should share lines.
    text = "\n".join(str(i) for i in range(DEFAULT_WINDOW + 10))
    chunks = _chunk_window("x.txt", text, window=DEFAULT_WINDOW, overlap=DEFAULT_OVERLAP)
    assert len(chunks) >= 2
    c0_lines = set(chunks[0].content.splitlines())
    c1_lines = set(chunks[1].content.splitlines())
    assert c0_lines & c1_lines  # non-empty overlap


def test_window_chunk_indices_are_sequential():
    text = "\n".join("x" for _ in range(200))
    chunks = _chunk_window("x.txt", text)
    assert [c.chunk_idx for c in chunks] == list(range(len(chunks)))


# ---------------------------------------------------------------------------
# HashEmbedder
# ---------------------------------------------------------------------------
# CAPABILITIES.md: "hash (default) — Distances cluster near 1.0 — stricter
# values drop all hits."

def _embed(texts):
    emb = HashEmbedder()
    return asyncio.run(emb.embed(texts))


def test_hash_embedder_returns_correct_dimension():
    vecs = _embed(["hello world"])
    assert len(vecs) == 1
    assert len(vecs[0]) == EMBED_DIM  # 768


def test_hash_embedder_empty_input_returns_empty():
    vecs = _embed([])
    assert vecs == []


def test_hash_embedder_is_deterministic():
    text = "kv router coordinator dispatch"
    v1 = _embed([text])[0]
    v2 = _embed([text])[0]
    assert v1 == v2


def test_hash_embedder_different_texts_differ():
    v1 = _embed(["parse url string"])[0]
    v2 = _embed(["sha256 hash binary"])[0]
    assert v1 != v2


def test_hash_embedder_vectors_are_unit_norm():
    # _vec() normalises so |v| == 1.0.
    vecs = _embed(["any text here to embed and normalise"])
    norm = math.sqrt(sum(x * x for x in vecs[0]))
    assert abs(norm - 1.0) < 1e-6


def test_hash_embedder_batch_matches_individual():
    texts = ["alpha tokens", "beta tokens", "gamma tokens"]
    batch = _embed(texts)
    for i, t in enumerate(texts):
        single = _embed([t])[0]
        assert batch[i] == single


# ---------------------------------------------------------------------------
# HashEmbedder distance properties (CAPABILITIES.md min_score note)
# ---------------------------------------------------------------------------

def test_identical_docs_have_near_zero_distance():
    # Cosine distance(v, v) = 1 - cos(0) = 0.
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        text = "identical document text"
        [vec] = await emb.embed([text])
        await store.upsert_chunks([UpsertRow("x.md", 0, text, vec, {})])
        hits = await store.search(vec, k=1)
        return hits[0].distance
    dist = asyncio.run(run())
    assert dist < 0.01


def test_dissimilar_docs_have_distance_near_one():
    # CAPABILITIES.md: hash embedder distances "cluster near 1.0".
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        doc = "completely different topic about databases"
        query = "spacecraft propulsion systems laser"
        [dvec] = await emb.embed([doc])
        [qvec] = await emb.embed([query])
        await store.upsert_chunks([UpsertRow("x.md", 0, doc, dvec, {})])
        hits = await store.search(qvec, k=1)
        return hits[0].distance
    dist = asyncio.run(run())
    assert dist > 0.5  # dissimilar → high cosine distance


# ---------------------------------------------------------------------------
# retrieve() contract
# ---------------------------------------------------------------------------

def test_retrieve_empty_query_raises_value_error():
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        await retrieve("   ", embedder=emb, store=store, k=3)

    with pytest.raises(ValueError, match="non-empty"):
        asyncio.run(run())


def test_retrieve_returns_retrieved_chunk_instances():
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        [vec] = await emb.embed(["test content"])
        await store.upsert_chunks([UpsertRow("a.py", 0, "test content", vec, {"lang": "python"})])
        return await retrieve("test content", embedder=emb, store=store, k=1)

    hits = asyncio.run(run())
    assert len(hits) == 1
    h = hits[0]
    assert isinstance(h, RetrievedChunk)
    assert h.content == "test content"
    assert h.source_path == "a.py"
    assert h.metadata == {"lang": "python"}
    assert isinstance(h.distance, float)


def test_retrieve_k_limits_results():
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        texts = [f"document number {i}" for i in range(5)]
        vecs = await emb.embed(texts)
        rows = [UpsertRow(f"d{i}.md", 0, t, v, {}) for i, (t, v) in enumerate(zip(texts, vecs))]
        await store.upsert_chunks(rows)
        return await retrieve("document number", embedder=emb, store=store, k=2)

    hits = asyncio.run(run())
    assert len(hits) <= 2


def test_retrieve_results_ordered_by_distance():
    async def run():
        store = InMemoryStore()
        emb = HashEmbedder()
        texts = ["parse url query params", "hash binary data sha256", "render react dom tree"]
        vecs = await emb.embed(texts)
        rows = [UpsertRow(f"{i}.py", 0, t, v, {}) for i, (t, v) in enumerate(zip(texts, vecs))]
        await store.upsert_chunks(rows)
        return await retrieve("parse url query", embedder=emb, store=store, k=3)

    hits = asyncio.run(run())
    distances = [h.distance for h in hits]
    assert distances == sorted(distances)


def test_retrieve_propagates_embed_error():
    async def run():
        store = InMemoryStore()
        bad_emb = MagicMock()
        bad_emb.embed = AsyncMock(side_effect=RuntimeError("embed backend down"))
        await retrieve("query", embedder=bad_emb, store=store, k=1)

    with pytest.raises(RuntimeError, match="embed backend down"):
        asyncio.run(run())


# ---------------------------------------------------------------------------
# Chunker — max-chars cap (long functions embed fully, not truncated)
# ---------------------------------------------------------------------------
# chunker.py: _cap_chunk_sizes re-splits any chunk > max_chars into overlapping
# line sub-chunks so the whole body reaches the embedder (bge-base truncates at
# 512 tokens). Sub-chunks preserve metadata and chunk_idx stays contiguous.

def _long_cpp_function(n_lines: int = 400) -> str:
    body = "\n".join(f"    x += {i};  // padding line to add bytes" for i in range(n_lines))
    return f"int huge(int x) {{\n{body}\n    return x;\n}}\n"


def test_oversized_chunk_is_split_under_cap():
    chunks = chunk_text("big.cpp", _long_cpp_function())
    assert len(chunks) > 1
    assert all(len(c.content) <= DEFAULT_MAX_CHARS for c in chunks)


def test_oversized_split_preserves_name_and_marks_parts():
    chunks = chunk_text("big.cpp", _long_cpp_function())
    parts = [c for c in chunks if "part" in c.metadata]
    assert len(parts) > 1
    # original function metadata (name/lang) carried onto every part
    assert all(p.metadata.get("name") == "huge" for p in parts)
    assert all(p.metadata.get("lang") == "cpp" for p in parts)
    # part/parts bookkeeping is consistent
    total = len(parts)
    assert {p.metadata["part"] for p in parts} == set(range(total))
    assert all(p.metadata["parts"] == total for p in parts)


def test_oversized_split_keeps_chunk_idx_contiguous():
    # A split must renumber so the (source_path, chunk_idx) PK stays 0..N-1.
    src = _long_cpp_function() + "\nint tiny() { return 1; }\n"
    chunks = chunk_text("big.cpp", src)
    assert [c.chunk_idx for c in chunks] == list(range(len(chunks)))


def test_oversized_split_overlaps_between_parts():
    chunks = chunk_text("big.cpp", _long_cpp_function())
    parts = [c for c in chunks if "part" in c.metadata]
    # last line of part i reappears within the head of part i+1 (overlap window)
    tail = parts[0].content.splitlines()[-1]
    head = parts[1].content.splitlines()[:DEFAULT_OVERLAP]
    assert tail in head


def test_small_chunk_untouched_by_cap():
    # A function under the cap is passed through unchanged (no part metadata).
    src = "void hello() {\n    printf(\"hi\");\n}\n"
    chunks = chunk_text("main.cpp", src)
    assert len(chunks) == 1
    assert "part" not in chunks[0].metadata
    assert chunks[0].metadata["name"] == "hello"


def test_single_overlong_line_becomes_its_own_chunk():
    # A line longer than the cap can't be split mid-token — it stays one chunk.
    giant = "x" * (DEFAULT_MAX_CHARS + 500)
    chunks = chunk_text("note.txt", giant + "\n")
    assert len(chunks) == 1
    assert chunks[0].content.startswith("x")


# ---------------------------------------------------------------------------
# Chunker — explosion guard (_split_oversized: huge/long-line inputs)
# ---------------------------------------------------------------------------
# Regression for the runaway split where overlap > part-size collapsed progress
# to ~1 line/part and exploded one giant vendored file into ~800k sub-chunks.

from orchestration.rag.chunker import (  # noqa: E402
    Chunk, MAX_PARTS_PER_CHUNK, _split_oversized,
)


def _oversized(n_lines: int, line_len: int) -> Chunk:
    body = "\n".join("y" * line_len for _ in range(n_lines))
    return Chunk(source_path="huge.cpp", chunk_idx=0, content=body,
                 metadata={"lang": "cpp", "name": "f"})


def test_split_caps_parts_and_preserves_tail():
    # ~1 line per part (line_len near the cap) would be 5000 parts without the
    # MAX_PARTS guard; it must cap and emit the remaining tail (no data loss).
    ch = _oversized(5000, DEFAULT_MAX_CHARS - 10)
    parts = _split_oversized(ch, max_chars=DEFAULT_MAX_CHARS, overlap=DEFAULT_OVERLAP)
    assert len(parts) <= MAX_PARTS_PER_CHUNK + 1
    assert parts[-1].metadata.get("truncated_split") is True
    # tail is preserved (not dropped): the file's last line lives in the tail part
    assert ch.content.splitlines()[-1] in parts[-1].content.splitlines()


def test_split_progress_bounded_for_midsize_lines():
    # ~3 lines per part: the half-part step floor keeps part count well under
    # the line count (no near-1-line-per-part overlap collapse).
    ch = _oversized(300, DEFAULT_MAX_CHARS // 3)
    parts = _split_oversized(ch, max_chars=DEFAULT_MAX_CHARS, overlap=DEFAULT_OVERLAP)
    assert len(parts) < 300
    assert all(len(p.content) <= DEFAULT_MAX_CHARS for p in parts
               if not p.metadata.get("truncated_split"))


def test_split_normal_function_keeps_overlap():
    # Short lines → many fit per part → real overlap (not the explosion path).
    ch = _oversized(400, 40)
    parts = _split_oversized(ch, max_chars=DEFAULT_MAX_CHARS, overlap=DEFAULT_OVERLAP)
    assert 1 < len(parts) < MAX_PARTS_PER_CHUNK
    tail = parts[0].content.splitlines()[-1]
    assert tail in parts[1].content.splitlines()[:DEFAULT_OVERLAP]
