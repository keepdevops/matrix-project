"""Filesystem-based mode discovery — drop a file into orchestration/modes/, get it for free.

A module qualifies as a mode if it defines exactly one subclass of OrchestrationMode
with a non-empty `mode_id`. Helpers can live under `_helpers/` (underscore-prefixed,
ignored by the scanner).

`run_mode` is the instrumented entrypoint: it wraps execution with metric counters
and per-token accounting so individual modes don't need to know about telemetry.
"""
from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
from pathlib import Path
from typing import AsyncIterator

from .base import Event, ModeContext, OrchestrationMode

logger = logging.getLogger(__name__)

MODES_DIR = Path(__file__).resolve().parent
_PACKAGE = __package__  # "orchestration.modes"

_registry: dict[str, type[OrchestrationMode]] = {}


def discover_modes(force: bool = False) -> dict[str, type[OrchestrationMode]]:
    """Scan this package for OrchestrationMode subclasses. Cached unless force=True."""
    if _registry and not force:
        return _registry
    _registry.clear()

    for info in pkgutil.iter_modules([str(MODES_DIR)]):
        if info.name.startswith("_") or info.name in {"base", "registry"}:
            continue
        modname = f"{_PACKAGE}.{info.name}"
        try:
            mod = importlib.import_module(modname)
        except Exception as exc:
            logger.error("failed to import mode module %s: %s", modname, exc)
            raise

        found: list[type[OrchestrationMode]] = []
        for _, obj in inspect.getmembers(mod, inspect.isclass):
            if (
                issubclass(obj, OrchestrationMode)
                and obj is not OrchestrationMode
                and obj.__module__ == modname
            ):
                found.append(obj)

        if not found:
            logger.error("mode module %s has no OrchestrationMode subclass", modname)
            raise RuntimeError(f"{modname}: no mode class found")
        if len(found) > 1:
            logger.error("mode module %s has multiple mode classes: %s", modname, found)
            raise RuntimeError(f"{modname}: exactly one mode class expected")

        cls = found[0]
        if not cls.mode_id:
            logger.error("mode class %s missing mode_id", cls)
            raise RuntimeError(f"{cls.__name__}: mode_id must be non-empty")
        if cls.mode_id in _registry:
            logger.error("duplicate mode_id %r (%s vs %s)",
                         cls.mode_id, _registry[cls.mode_id], cls)
            raise RuntimeError(f"duplicate mode_id: {cls.mode_id}")
        _registry[cls.mode_id] = cls

    logger.info("[BOOT] discovered %d orchestration modes: %s",
                len(_registry), sorted(_registry))
    return _registry


async def run_mode(mode_id: str, ctx: ModeContext, query: str) -> AsyncIterator[Event]:
    """Instrumented execution: token counters + total-latency histogram + request counter.

    Imported lazily so registry.py stays importable without prometheus_client when
    telemetry isn't wired (e.g. trivial unit tests).
    """
    from orchestration.telemetry.metrics import (
        AGENT_TOKENS,
        instrument_mode,
    )

    cls = get_mode(mode_id)
    async with instrument_mode(mode_id, ctx.agents):
        async for ev in cls().execute(ctx, query):
            if ev.kind == "token" and ev.agent_id and ev.text:
                AGENT_TOKENS.labels(
                    agent_id=ev.agent_id, direction="completion"
                ).inc(len(ev.text))
            yield ev


def get_mode(mode_id: str) -> type[OrchestrationMode]:
    if not _registry:
        discover_modes()
    try:
        return _registry[mode_id]
    except KeyError:
        logger.error("unknown mode_id %r (known: %s)", mode_id, sorted(_registry))
        raise
