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
) -> list[Chunk]:
    """Dispatch to the right splitter based on file extension."""
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
