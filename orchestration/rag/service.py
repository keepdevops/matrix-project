"""HTTP sidecar exposing the existing RAG ingest stack to the React UI.

Endpoints (all return JSON, all allow CORS *):
    GET    /health                    — pgvector reachability + embedder name
    POST   /ingest                    — multipart upload, returns {job_id}
    GET    /jobs/{id}                 — job status / chunk count / error
    GET    /documents                 — list source_paths in the store
    DELETE /documents?source=...      — remove all chunks for one source

Re-uses orchestration/rag/{chunker,embed,store}.py verbatim — no logic fork.
Source-path scheme for uploaded files is `upload://<safe-filename>` so we
never leak filesystem layout and never path-traverse on delete.

CLAUDE.md §2: validation + loud errors. CLAUDE.md §1: keep this file under
300 LOC — job registry already split into service_jobs.py.
"""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from aiohttp import web

from orchestration.rag import chunk_text
from orchestration.rag.embed import HashEmbedder, MLXEmbedder
from orchestration.rag.retrieve import retrieve
from orchestration.rag.service_jobs import JobRegistry
from orchestration.rag.store import PgVectorStore, UpsertRow

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = int(os.environ.get("RAG_INGEST_MAX_BYTES", 25 * 1024 * 1024))
ALLOWED_EXTS = {".md", ".txt", ".py", ".js", ".jsx", ".ts", ".tsx",
                ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
                ".yaml", ".yml", ".json"}
SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]")


def _pick_embedder(name: str):
    if name == "mlx":
        return MLXEmbedder()
    if name == "hash":
        return HashEmbedder()
    raise web.HTTPBadRequest(reason=f"unknown embedder: {name}")


def _safe_name(filename: str) -> str:
    base = os.path.basename(filename or "").strip()
    if not base:
        raise web.HTTPBadRequest(reason="missing filename")
    cleaned = SAFE_NAME_RE.sub("_", base)[:200]
    if not cleaned or cleaned.startswith("."):
        raise web.HTTPBadRequest(reason="invalid filename")
    ext = os.path.splitext(cleaned)[1].lower()
    if ext not in ALLOWED_EXTS:
        raise web.HTTPBadRequest(
            reason=f"extension {ext!r} not in allowlist",
        )
    return cleaned


def _cors(resp: web.StreamResponse) -> web.StreamResponse:
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@web.middleware
async def cors_mw(request: web.Request, handler: Any) -> web.StreamResponse:
    if request.method == "OPTIONS":
        return _cors(web.Response(status=204))
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        _cors(exc)
        raise
    return _cors(resp)


async def _embed_and_upsert(
    source_path: str, text: str, embedder, store: PgVectorStore,
) -> int:
    chunks = chunk_text(source_path, text)
    if not chunks:
        logger.error("rag-ingest: %s produced 0 chunks", source_path)
        return 0
    vecs = await embedder.embed([c.content for c in chunks])
    rows = [
        UpsertRow(
            source_path=c.source_path,
            chunk_idx=c.chunk_idx,
            content=c.content,
            embedding=v,
            metadata=c.metadata,
        )
        for c, v in zip(chunks, vecs)
    ]
    return await store.upsert_chunks(rows)


async def handle_health(request: web.Request) -> web.Response:
    store: PgVectorStore = request.app["store"]
    embedder_name: str = request.app["embedder_name"]
    try:
        pool = await store._pool_or_connect()  # noqa: SLF001
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return web.json_response({"ok": True, "embedder": embedder_name})
    except Exception as exc:
        logger.error("rag-ingest: health probe failed: %s", exc)
        return web.json_response(
            {"ok": False, "embedder": embedder_name, "error": str(exc)},
            status=503,
        )


async def handle_ingest(request: web.Request) -> web.Response:
    reader = await request.multipart()
    field = await reader.next()
    if field is None or field.name != "file":
        raise web.HTTPBadRequest(reason="expected multipart field 'file'")
    safe = _safe_name(field.filename or "")
    source_path = f"upload://{safe}"

    # Stream into memory with a hard cap.
    buf = bytearray()
    while True:
        chunk = await field.read_chunk(size=64 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > MAX_UPLOAD_BYTES:
            raise web.HTTPRequestEntityTooLarge(
                max_size=MAX_UPLOAD_BYTES, actual_size=len(buf),
            )
    try:
        text = buf.decode("utf-8", errors="replace")
    except Exception as exc:
        logger.error("rag-ingest: decode %s failed: %s", source_path, exc)
        raise web.HTTPBadRequest(reason="file is not valid text")

    registry: JobRegistry = request.app["jobs"]
    store: PgVectorStore = request.app["store"]
    embedder = request.app["embedder"]
    job = await registry.create(source_path)

    async def work() -> int:
        return await _embed_and_upsert(source_path, text, embedder, store)

    # Fire-and-forget; status flows through the registry.
    request.app.loop.create_task(registry.run(job, work))
    return web.json_response({"job_id": job.id, "source_path": source_path})


async def handle_job(request: web.Request) -> web.Response:
    job_id = request.match_info["job_id"]
    registry: JobRegistry = request.app["jobs"]
    job = await registry.get(job_id)
    if job is None:
        raise web.HTTPNotFound(reason=f"unknown job {job_id}")
    return web.json_response(job.to_dict())


async def handle_embed(request: web.Request) -> web.Response:
    """POST /embed {"texts": [...]} → {"vectors": [[...], ...]}

    Used by the C++ coordinator when embedder == "mlx" so that semantic
    embeddings are computed here in Python and returned as a JSON array.
    """
    try:
        body = await request.json()
    except Exception as exc:
        logger.error("rag-embed: invalid JSON: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON body")
    texts = body.get("texts")
    if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
        raise web.HTTPBadRequest(reason="'texts' must be a list of strings")
    if len(texts) > 512:
        raise web.HTTPBadRequest(reason="'texts' exceeds max batch size of 512")
    embedder = request.app["embedder"]
    try:
        vectors = await embedder.embed(texts)
    except Exception as exc:
        logger.error("rag-embed: embed failed: %s", exc)
        raise web.HTTPInternalServerError(reason=f"embed error: {exc}")
    return web.json_response({"vectors": vectors})


async def handle_retrieve(request: web.Request) -> web.Response:
    """POST /retrieve — embed query and return top-k chunks for orchestration modes."""
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError(f"expected JSON object, got {type(body).__name__}")
    except Exception as exc:
        logger.error("retrieve: bad JSON: %s", exc)
        raise web.HTTPBadRequest(reason="invalid JSON")
    query = (body.get("query") or "").strip()
    if not query:
        raise web.HTTPBadRequest(reason="'query' required")
    k = max(1, int(body.get("k", 3)))
    try:
        hits = await retrieve(query, embedder=request.app["embedder"],
                              store=request.app["store"], k=k)
    except Exception as exc:
        logger.error("retrieve: failed query=%r: %s", query[:60], exc)
        raise web.HTTPInternalServerError(reason=str(exc))
    return web.json_response({
        "chunks": [
            {"content": h.content, "source_path": h.source_path, "distance": h.distance}
            for h in hits
        ]
    })


async def handle_documents(request: web.Request) -> web.Response:
    store: PgVectorStore = request.app["store"]
    if request.method == "DELETE":
        src = request.query.get("source", "").strip()
        if not src:
            raise web.HTTPBadRequest(reason="missing ?source=")
        removed = await store.delete_source(src)
        return web.json_response({"source_path": src, "removed": removed})
    docs = await store.list_sources()
    return web.json_response({"documents": docs})


def make_app(embedder_name: str = "hash") -> web.Application:
    app = web.Application(middlewares=[cors_mw], client_max_size=MAX_UPLOAD_BYTES)
    app["store"] = PgVectorStore()
    app["embedder"] = _pick_embedder(embedder_name)
    app["embedder_name"] = embedder_name
    app["jobs"] = JobRegistry()
    app.router.add_get("/health", handle_health)
    app.router.add_post("/embed", handle_embed)
    app.router.add_post("/ingest", handle_ingest)
    app.router.add_get("/jobs/{job_id}", handle_job)
    app.router.add_get("/documents", handle_documents)
    app.router.add_delete("/documents", handle_documents)
    app.router.add_post("/retrieve", handle_retrieve)

    async def _cleanup(app_: web.Application) -> None:
        await app_["store"].close()
    app.on_cleanup.append(_cleanup)
    return app


def main() -> None:
    import argparse
    logging.basicConfig(
        level=os.environ.get("RAG_INGEST_LOG", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    p = argparse.ArgumentParser(prog="rag-ingest-server")
    p.add_argument("--host", default=os.environ.get("RAG_INGEST_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int,
                   default=int(os.environ.get("RAG_INGEST_PORT", "8001")))
    p.add_argument("--embedder", choices=["hash", "mlx"],
                   default=os.environ.get("RAG_INGEST_EMBEDDER", "hash"))
    args = p.parse_args()
    web.run_app(make_app(args.embedder), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
