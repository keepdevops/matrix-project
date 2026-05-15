"""In-process job registry for the RAG ingest sidecar.

Jobs are stored in a dict keyed by short uuid; lifecycle is queued → running →
done|error. The registry trims completed jobs older than RETENTION_S so the
process doesn't grow unbounded over a long-running session.

CLAUDE.md §2: all failure paths log via `logger.error` — no silent catches.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal

logger = logging.getLogger(__name__)

RETENTION_S = 60 * 30  # keep terminal jobs visible for 30 minutes
MAX_JOBS = 256

JobStatus = Literal["queued", "running", "done", "error"]


@dataclass
class Job:
    id: str
    source_path: str
    status: JobStatus = "queued"
    chunks: int = 0
    error: str | None = None
    started: float = field(default_factory=time.time)
    finished: float | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_path": self.source_path,
            "status": self.status,
            "chunks": self.chunks,
            "error": self.error,
            "started": self.started,
            "finished": self.finished,
        }


class JobRegistry:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create(self, source_path: str) -> Job:
        async with self._lock:
            self._gc_locked()
            job = Job(id=uuid.uuid4().hex[:12], source_path=source_path)
            self._jobs[job.id] = job
            return job

    async def get(self, job_id: str) -> Job | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def run(
        self,
        job: Job,
        work: Callable[[], Awaitable[int]],
    ) -> None:
        """Execute `work()` and mark the job done/error. Returned int is the
        chunk count to record on success."""
        job.status = "running"
        try:
            count = await work()
            job.chunks = count
            job.status = "done"
        except Exception as exc:
            logger.error("rag-ingest: job %s failed: %s", job.id, exc)
            job.error = str(exc)
            job.status = "error"
        finally:
            job.finished = time.time()

    def _gc_locked(self) -> None:
        if len(self._jobs) <= MAX_JOBS:
            cutoff = time.time() - RETENTION_S
            stale = [
                jid for jid, j in self._jobs.items()
                if j.finished is not None and j.finished < cutoff
            ]
        else:
            # Hard cap: drop oldest terminal jobs
            terminal = sorted(
                ((j.finished or 0, jid) for jid, j in self._jobs.items()
                 if j.finished is not None),
            )
            stale = [jid for _, jid in terminal[: len(self._jobs) - MAX_JOBS + 1]]
        for jid in stale:
            self._jobs.pop(jid, None)
