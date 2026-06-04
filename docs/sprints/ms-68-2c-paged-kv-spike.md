# MS-68 2c — Paged KV spike: findings + GO/NO-GO

**Sub-phase:** 2c (Paged KV) from [ms-68-phase2-scope.md](./ms-68-phase2-scope.md)
**Type:** measured spike (treated like MS-160 — measure first, report honestly)
**Date:** 2026-06-03 · **Probe:** `scripts/mlx_prompt_cache_probe.py`

## Question

Phase 1 left a C++ stub (`paged_kv_cache.{h,cpp}`) envisioning a custom
**Metal-backed paged KV cache** with prefix reuse + eviction. Is that worth
building for the in-process MLX path?

## What we found

**MLX already owns the KV-cache layer.** `mlx_lm` 0.31.3 ships a full toolkit:
`KVCache`, `RotatingKVCache`, `ChunkedKVCache`, `QuantizedKVCache`,
`LRUPromptCache`, `PromptTrie`, and `make_prompt_cache` / `trim_prompt_cache` /
`save_prompt_cache`. `generate`/`generate_step` accept a `prompt_cache`.

A hand-rolled C++ Metal paged cache would duplicate — and fight — this. So the
real question becomes: **does mlx_lm's prompt-cache reuse pay off in-process?**

### Measurement (Llama-3.2-3B-Instruct-4bit, M3 Max)

Reuse only works **one way**: a persistent per-session cache **fed token
deltas** (the new suffix), not re-sent the full prompt each turn. The pattern
matters more than the size:

| Pattern | ~1.2k ctx | ~10.8k ctx |
|---|---|---|
| **Wrong** — full prompt + persistent cache (double-processes) | ≤1× (harmful) | ≤1× (harmful) |
| **Right** — delta-feed against primed cache | **4.5×** | **34×** |

Done right, reuse wins even at ~1.2k tokens (955 ms → 212 ms/turn) and scales
hard: at 10.8k tokens, one-time prime 9.6 s then ~277 ms/turn (vs ~9.5 s),
3-turn total 28.6 s → 10.4 s. **The pitfall is real and worth flagging**:
naively handing a persistent cache the full prompt each turn is *slower* than
no cache — the implementation must compute and feed only the delta.

## Verdict

- **NO-GO — custom Metal paged KV cache.** MLX subsumes this layer; building our
  own is redundant, high-risk, and out of reach. **Recommend deleting the
  `paged_kv_cache` stub** — it's the wrong abstraction.
- **GO — session prompt-cache reuse**, as its own scoped sub-phase (call it
  **2c′**), *not* the stub's design. Wins from ~1k tokens up (4.5×) and scales
  to 34× on long reused contexts (RAG docs, long system prompts, multi-turn).
  The cost is architectural, not perf-uncertain: delta-feeding + per-session
  cache state (see below).

## What 2c′ would require (not in this spike)

The in-process registry currently does **stateless full-prompt** generation. To
exploit prompt-cache reuse it must:

1. Keep an `mlx_lm` prompt cache **per session** (key it with the session_id;
   evict via `LRUPromptCache` / idle, alongside the existing model eviction).
2. Feed **deltas** — compute the new-token suffix vs the cached prefix and
   process only that (or require callers to send deltas). `trim_prompt_cache`
   handles divergence/branching.
3. Gate on a **context-size threshold** so small prompts skip the machinery.
4. Optionally offer `QuantizedKVCache` for the memory dimension.

This is a real behavior change to the generate path + serialized lane, and
should be scoped/measured on its own before implementation — exactly the
discipline that turned the original "paged KV" idea from a build into a
one-line stub deletion plus a targeted, evidence-backed follow-up.
