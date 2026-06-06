"""brewctl up / down — orchestrate the full stack (pgvector + sidecar + UI).

up:    rag-docker-compose up → wait pgvector → spawn rag ingest sidecar → run_launch
down:  run_shutdown → kill sidecar :8001 → optionally rag-docker-compose down
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

from ._proc import kill_pids, lsof_pids_on_port
from .launch import run_launch
from .shutdown import run_shutdown

logger = logging.getLogger(__name__)

REPO = Path(__file__).resolve().parents[2]
SIDECAR_PORT = 8001
RAG_WRAPPER = REPO / "scripts" / "rag-docker-compose.sh"
SIDECAR_SCRIPT = REPO / "scripts" / "rag-ingest-server.py"

# Extra source trees to auto-index alongside the repo so agents can retrieve from
# them — e.g. the llama.cpp source. Override with MATRIX_RAG_EXTRA_INDEX_PATHS
# (colon-separated); defaults to the llama.cpp checkout when present.
DEFAULT_EXTRA_INDEX_PATHS = ("/Users/Shared/llama/llama.cpp",)


def _extra_index_paths() -> list[Path]:
    raw = os.environ.get("MATRIX_RAG_EXTRA_INDEX_PATHS")
    candidates = raw.split(":") if raw else list(DEFAULT_EXTRA_INDEX_PATHS)
    paths: list[Path] = []
    for c in candidates:
        c = c.strip()
        if not c:
            continue
        p = Path(c)
        if p.is_dir():
            paths.append(p)
        else:
            logger.warning("auto-index: extra path %s not found — skipping", p)
    return paths


def _run(cmd: list[str], **kw) -> int:
    return subprocess.run(cmd, cwd=REPO, **kw).returncode


def _wait_port(port: int, timeout: float = 15.0) -> bool:
    import socket
    end = time.time() + timeout
    while time.time() < end:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            try:
                s.connect(("127.0.0.1", port))
                return True
            except OSError:
                time.sleep(0.2)
    return False


def _pgvector_up() -> int:
    if not RAG_WRAPPER.is_file():
        logger.error("rag-docker-compose.sh missing at %s", RAG_WRAPPER)
        print(f"FATAL: {RAG_WRAPPER} not found")
        return 2
    print("Starting pgvector ...")
    rc = _run(["bash", str(RAG_WRAPPER), "up"])
    if rc != 0:
        logger.error("rag-docker-compose up failed rc=%d", rc)
        print(f"FATAL: pgvector failed to start (rc={rc})")
        return rc
    rc = _run(["bash", str(RAG_WRAPPER), "wait"])
    if rc != 0:
        logger.error("pgvector did not become ready (rc=%d)", rc)
        return rc
    return 0


def _sidecar_up() -> int:
    if not SIDECAR_SCRIPT.is_file():
        logger.error("sidecar script missing at %s", SIDECAR_SCRIPT)
        print(f"FATAL: {SIDECAR_SCRIPT} not found")
        return 2
    if lsof_pids_on_port(SIDECAR_PORT):
        print(f"Sidecar already running on :{SIDECAR_PORT}, skipping spawn")
        return 0
    print(f"Starting RAG ingest sidecar on :{SIDECAR_PORT} ...")
    logs = REPO / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log_fp = open(logs / "rag-sidecar.log", "ab")
    proc = subprocess.Popen(
        [sys.executable, str(SIDECAR_SCRIPT)],
        cwd=REPO, env=os.environ.copy(),
        stdout=log_fp, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    if not _wait_port(SIDECAR_PORT, timeout=15.0):
        logger.error("sidecar did not bind :%d (pid=%d)", SIDECAR_PORT, proc.pid)
        print(f"FATAL: sidecar pid={proc.pid} never bound :{SIDECAR_PORT}")
        print(f"  See logs/rag-sidecar.log")
        return 3
    print(f"  sidecar pid={proc.pid} ready")
    return 0


def _auto_index(paths: list[Path]) -> None:
    """Kick off a single background re-index of all paths using the mlx embedder.

    One process indexes every path sequentially so the MLX embedder is loaded
    once and the GPU lane is not contended by parallel indexers.
    """
    brewctl = REPO / "scripts" / "brewctl"
    logs = REPO / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    log_fp = open(logs / "rag-autoindex.log", "ab")
    cmd = [sys.executable, str(brewctl), "rag", "index",
           *[str(p) for p in paths], "--embedder", "mlx"]
    proc = subprocess.Popen(
        cmd, cwd=REPO, env=os.environ.copy(),
        stdout=log_fp, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    joined = ", ".join(str(p) for p in paths)
    print(f"  auto-index pid={proc.pid} indexing {joined} → logs/rag-autoindex.log")


def run_up(no_rag: bool = False, no_index: bool = False, index_path: Path | None = None) -> int:
    print("=" * 60)
    print("SWARM MATRIX up" + (" (no-rag)" if no_rag else ""))
    if not no_rag:
        rc = _pgvector_up()
        if rc != 0:
            return rc
        rc = _sidecar_up()
        if rc != 0:
            return rc
        if not no_index:
            targets = [index_path or REPO, *_extra_index_paths()]
            print(f"Auto-indexing {len(targets)} path(s) in background ...")
            _auto_index(targets)
    return run_launch()


def _sidecar_down() -> None:
    pids = lsof_pids_on_port(SIDECAR_PORT)
    if not pids:
        print(f"  no sidecar on :{SIDECAR_PORT}")
        return
    print(f"  stopping sidecar :{SIDECAR_PORT} pids={pids}")
    survivors = kill_pids(pids)
    if survivors:
        logger.error("sidecar pids still alive: %s", survivors)


def _pgvector_down() -> int:
    if not RAG_WRAPPER.is_file():
        logger.error("rag-docker-compose.sh missing at %s", RAG_WRAPPER)
        return 0
    print("Stopping pgvector ...")
    return _run(["bash", str(RAG_WRAPPER), "down"])


def run_down(full: bool = False) -> int:
    rc = run_shutdown()
    print("-" * 60)
    _sidecar_down()
    if full:
        rc2 = _pgvector_down()
        if rc2 != 0:
            logger.error("pgvector down rc=%d", rc2)
            rc = rc or rc2
    else:
        print("  pgvector left running (use --full to also stop it)")
    return rc
