"""Regenerate tests/cpp/rag_embed_fixtures.txt from the Python HashEmbedder.

Run from repo root:
    python3 tests/rag/gen_embed_fixtures.py

The C++ test (tests/cpp/rag_embed_test.cpp) asserts byte-equality with this
output — keeping both runtimes in lockstep when either side changes.
"""
from __future__ import annotations

import asyncio
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from orchestration.rag.embed import HashEmbedder  # noqa: E402
from orchestration.rag.store import _vec_literal  # noqa: E402

FIXTURES = [
    "",
    "x",
    "hello world",
    "kv router",
    "the quick brown fox jumps over the lazy dog",
    "  multi   space   ",
    "line1\nline2\tline3",
    "unicode: café naïve résumé",
    "/* C comment with symbols !@#$%^&*() */",
    "matrix coordinator dispatch",
]


async def main() -> int:
    out_path = ROOT / "tests" / "cpp" / "rag_embed_fixtures.txt"
    embedder = HashEmbedder()
    vecs = await embedder.embed(FIXTURES)
    parts = []
    for text, vec in zip(FIXTURES, vecs):
        # _vec_literal yields "[v0,v1,...]"; strip the brackets — the test
        # framing in rag_embed_test.cpp adds them back.
        lit = _vec_literal(vec)[1:-1]
        parts.append(f"{text}\n===VEC===\n{lit}")
    payload = "\n---\n".join(parts) + "\n"
    out_path.write_text(payload)
    print(f"wrote {len(FIXTURES)} fixtures to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
