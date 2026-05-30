#!/usr/bin/env python3
"""Launcher for the RAG ingest sidecar.

Defaults: listens on 127.0.0.1:8001, hash embedder. Override via env:
    RAG_INGEST_HOST, RAG_INGEST_PORT, RAG_INGEST_EMBEDDER (hash|mlx)
    RAG_INGEST_MAX_BYTES (default 25 MiB)
    RAG_DSN (shared with the C++ coordinator and brewctl)

Run:
    conda activate mlx-env
    python scripts/rag-ingest-server.py --embedder mlx
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from orchestration.rag.service import main  # noqa: E402

if __name__ == "__main__":
    main()
