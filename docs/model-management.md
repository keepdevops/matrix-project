# MLX Model Management — In-Process Dispatch (MS-161)

Operator guide for the optional in-process MLX inference path. **Off by default.**
macOS Apple Silicon only.

## What it is

MLX agents normally run as separate `mlx_lm.server` processes; the coordinator
reaches them over HTTP. With in-process dispatch, the coordinator embeds CPython +
`mlx_lm` and runs generation **in its own address space** — removing the HTTP
round-trip. Measured **+74–107% single-stream throughput** (MS-153/Phase A) and
the model is resident **once** in the coordinator (vs a separate server process).

> **Scope:** sequential inference only (single-agent chat, and `/api/mlx/submit`).
> A single GPU gives no concurrent-throughput benefit (MS-160), and all
> in-process generation is **serialized through one lane** — which is why it is
> stable (no OOM) and why concurrent flat-mode fan-out should stay on HTTP.

## Enabling it

Two opt-in pieces — both required:

1. **Build flag** — compile the coordinator with in-process support:
   ```bash
   MATRIX_MLX_NATIVE_COORD=1 MATRIX_MLX_INPROC=1 \
     MLX_ENV_PREFIX=~/miniforge3/envs/mlx-env \
     bash scripts/build_cpp_binaries.sh
   ```
   This links `libpython3.12` into the `coordinator` binary (Darwin arm64 only).
   Without `MATRIX_MLX_INPROC`, the coordinator is byte-for-byte the standard
   build — no Python dependency.

2. **Per-agent config** — tag the agent `"dispatch": "inproc"` in `swarm-config.json`:
   ```jsonc
   {
     "name": "chat",
     "engine": "mlx",
     "dispatch": "inproc",          // "http" (default) | "inproc"
     "model": "/path/to/Llama-3.2-3B-Instruct-4bit",
     "max_tokens": 512
   }
   ```
   Agents without `dispatch` (or set to `"http"`) keep using `mlx_lm.server` —
   no behavior change.

## Avoiding double model copies

A model loaded **in-process** lives in the coordinator; the same model served
over **HTTP** lives in its `mlx_lm.server`. To avoid two resident copies, route
each model through exactly one path: tag latency-critical / sequential agents
`inproc`, leave flat-mode fan-out workers on `http`.

## Observability

`GET /api/mlx/pressure` reports resident in-process models when the flag is on:

```jsonc
{
  "inflight":  { "8090": 0 },
  "sessions":  [ ... ],
  "resident_models": [
    { "model": "/path/...4bit", "agents_seen": 1, "calls": 12, "idle_secs": 3 }
  ],
  "resident_count": 1
}
```

Idle models are LRU-evicted after 10 min (`MlxModelRegistry::DEFAULT_IDLE_SECS`).

## Operational notes

- **Cold start:** first request to an `inproc` agent pays the one-time model load
  (~0.6–5 s depending on model + OS page cache). Subsequent requests reuse the
  resident model (~0.5 s for short generations).
- **Memory:** one model copy (~2.3 GB for a 3B-4bit) resident in the coordinator
  while in use; +~20–30 MB per concurrent session's KV cache.
- **Stability:** all in-process generation is serialized (one in flight). A 300-
  generate soak showed zero OOM and flat RSS (MS-161 Phase A).
- **Disabling:** drop `MATRIX_MLX_INPROC` from the build, or set the agent back to
  `"dispatch": "http"` and run `mlx_lm.server` as before.

## References

- Design: [docs/sprints/MS-161-design.md](sprints/MS-161-design.md)
- Concurrency finding: [docs/sprints/MS-160-concurrency-scope.md](sprints/MS-160-concurrency-scope.md)
- Single-stream benchmark: [docs/sprints/MS-153.md](sprints/MS-153.md)
