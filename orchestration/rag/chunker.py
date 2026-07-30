"""AST-aware code chunker with line-window fallback for unknown file types.

Per-language splitters live in this single module; if/when this grows past
~250 LOC, split per-language helpers into orchestration/rag/_chunkers/.
"""
from __future__ import annotations

import ast
import logging
import re
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

DEFAULT_WINDOW = 60   # lines per chunk for fallback
DEFAULT_OVERLAP = 8
# Hard cap on chunk size (characters). Oversized AST/brace chunks — e.g. a very
# long function — are re-split into overlapping sub-chunks so the whole body is
# embedded rather than truncated: bge-base cuts off at 512 tokens, and ~3
# chars/token for code puts that budget near 1500 chars. Tune via
# chunk_text(..., max_chars=...).
DEFAULT_MAX_CHARS = 1500
# Hard backstop on how many sub-chunks one oversized chunk may produce. Protects
# against pathological inputs (huge vendored/generated single-file headers) where
# tiny per-part line counts would otherwise explode the split. On reaching it the
# remaining tail is emitted as one chunk and a warning is logged.
MAX_PARTS_PER_CHUNK = 200


@dataclass(frozen=True)
class Chunk:
    source_path: str
    chunk_idx: int
    content: str
    metadata: dict


def chunk_text(
    source_path: str,
    text: str,
    *,
    window: int = DEFAULT_WINDOW,
    overlap: int = DEFAULT_OVERLAP,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[Chunk]:
    """Dispatch to the right splitter by extension, then cap oversized chunks so
    every chunk fits the embedder's token window (no silent truncation)."""
    raw = _dispatch(source_path, text, window=window, overlap=overlap)
    return _cap_chunk_sizes(raw, max_chars=max_chars, overlap=overlap)


def _dispatch(
    source_path: str, text: str, *, window: int, overlap: int,
) -> list[Chunk]:
    """Choose a splitter based on file extension."""
    ext = Path(source_path).suffix.lower()
    if ext == ".py":
        try:
            return _chunk_python(source_path, text)
        except SyntaxError as exc:
            logger.error("python AST parse failed for %s: %s — falling back to window",
                         source_path, exc)
    if ext in {".cpp", ".cc", ".cxx", ".h", ".hpp", ".c"}:
        return _chunk_cpp(source_path, text)
    if ext in {".ts", ".tsx", ".js", ".jsx"}:
        return _chunk_braces(source_path, text, lang=ext.lstrip("."))
    return _chunk_window(source_path, text, window=window, overlap=overlap)


def _chunk_python(source_path: str, text: str) -> list[Chunk]:
    tree = ast.parse(text)
    lines = text.splitlines()
    chunks: list[Chunk] = []
    for idx, node in enumerate(
        n for n in tree.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    ):
        start = node.lineno - 1
        end = getattr(node, "end_lineno", start + 1) or start + 1
        content = "\n".join(lines[start:end])
        chunks.append(Chunk(
            source_path=source_path,
            chunk_idx=idx,
            content=content,
            metadata={"lang": "python", "kind": type(node).__name__, "name": node.name,
                      "lineno": node.lineno},
        ))
    if not chunks:  # module-level only
        return _chunk_window(source_path, text)
    return chunks


_CPP_DECL = re.compile(
    r"^[A-Za-z_][\w:<>,\s\*&]*?\b([A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:const\s*)?\{",
    re.MULTILINE,
)


def _chunk_cpp(source_path: str, text: str) -> list[Chunk]:
    """Split on top-level brace-balanced blocks. Heuristic — robust enough for retrieval."""
    chunks: list[Chunk] = []
    starts = [(m.start(), m.group(1)) for m in _CPP_DECL.finditer(text)]
    if not starts:
        return _chunk_window(source_path, text)

    bounds: list[tuple[int, int, str]] = []
    for i, (pos, name) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
        # Try to find the matching closing brace from pos.
        depth = 0
        cursor = pos
        while cursor < end:
            c = text[cursor]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    cursor += 1
                    break
            cursor += 1
        bounds.append((pos, min(cursor, end), name))

    for idx, (a, b, name) in enumerate(bounds):
        chunks.append(Chunk(
            source_path=source_path,
            chunk_idx=idx,
            content=text[a:b],
            metadata={"lang": "cpp", "name": name},
        ))
    return chunks


_BRACE_BLOCK = re.compile(
    r"(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)\s*[^{;]*\{",
)


def _chunk_braces(source_path: str, text: str, *, lang: str) -> list[Chunk]:
    chunks: list[Chunk] = []
    for idx, m in enumerate(_BRACE_BLOCK.finditer(text)):
        start = m.start()
        depth = 0
        cursor = start
        while cursor < len(text):
            c = text[cursor]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    cursor += 1
                    break
            cursor += 1
        chunks.append(Chunk(
            source_path=source_path,
            chunk_idx=idx,
            content=text[start:cursor],
            metadata={"lang": lang, "name": m.group(1)},
        ))
    if not chunks:
        return _chunk_window(source_path, text)
    return chunks


def _chunk_window(
    source_path: str,
    text: str,
    *,
    window: int = DEFAULT_WINDOW,
    overlap: int = DEFAULT_OVERLAP,
) -> list[Chunk]:
    lines = text.splitlines()
    if not lines:
        return []
    chunks: list[Chunk] = []
    step = max(1, window - overlap)
    idx = 0
    i = 0
    while i < len(lines):
        block = lines[i : i + window]
        if not block:
            break
        chunks.append(Chunk(
            source_path=source_path,
            chunk_idx=idx,
            content="\n".join(block),
            metadata={"lang": "text", "line_start": i + 1, "line_end": i + len(block)},
        ))
        idx += 1
        i += step
    return chunks


def _cap_chunk_sizes(
    chunks: list[Chunk], *, max_chars: int, overlap: int,
) -> list[Chunk]:
    """Re-split any chunk longer than max_chars into overlapping line sub-chunks
    so the embedder sees the whole body, then renumber chunk_idx contiguously
    (the store PK is (source_path, chunk_idx), so indices must stay 0..N-1)."""
    capped: list[Chunk] = []
    for ch in chunks:
        if len(ch.content) <= max_chars:
            capped.append(ch)
        else:
            capped.extend(_split_oversized(ch, max_chars=max_chars, overlap=overlap))
    return [
        Chunk(source_path=c.source_path, chunk_idx=i, content=c.content,
              metadata=c.metadata)
        for i, c in enumerate(capped)
    ]


def _split_oversized(chunk: Chunk, *, max_chars: int, overlap: int) -> list[Chunk]:
    """Greedily pack whole lines into <=max_chars sub-chunks, overlapping by
    `overlap` lines so a split function keeps continuity across the boundary.
    A single line longer than max_chars becomes its own (still-oversized) chunk
    rather than being cut mid-token."""
    lines = chunk.content.splitlines()
    n = len(lines)
    parts: list[Chunk] = []
    i = 0
    while i < n:
        cur: list[str] = []
        size = 0
        j = i
        while j < n:
            add = len(lines[j]) + 1  # +1 for the newline join
            if cur and size + add > max_chars:
                break
            cur.append(lines[j])
            size += add
            j += 1
        meta = dict(chunk.metadata)
        meta["part"] = len(parts)
        parts.append(Chunk(
            source_path=chunk.source_path,
            chunk_idx=0,  # renumbered by _cap_chunk_sizes
            content="\n".join(cur),
            metadata=meta,
        ))
        if j >= n:
            break
        if len(parts) >= MAX_PARTS_PER_CHUNK:
            # Pathological input — emit the remaining tail as one chunk (so no
            # content is lost) and stop, rather than exploding the split.
            logger.error("chunker: %s hit the %d-part cap (%d lines) — emitting "
                         "the tail as one chunk; likely a vendored/generated file",
                         chunk.source_path, MAX_PARTS_PER_CHUNK, n)
            meta = dict(chunk.metadata)
            meta["part"] = len(parts)
            meta["truncated_split"] = True
            parts.append(Chunk(source_path=chunk.source_path, chunk_idx=0,
                               content="\n".join(lines[j:]), metadata=meta))
            break
        # Advance by at least half the part so `overlap` can never exceed the
        # part's line count and collapse progress to ~1 line/part (which would
        # blow up the sub-chunk count on long-line or huge inputs).
        consumed = j - i
        i += max((consumed + 1) // 2, consumed - overlap)
    for p in parts:
        p.metadata["parts"] = len(parts)
    return parts
