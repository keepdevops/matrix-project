# MS-68 2c′ — Session prompt-cache reuse: Scope

**Origin:** the [2c spike](./ms-68-2c-paged-kv-spike.md) GO verdict — the one real
win the Phase 2 spikes surfaced. Replaces the deleted `paged_kv_cache` stub.
**Status:** SCOPE (not started) · **Date:** 2026-06-03
**Builds on:** 2a (unified `model_mem::ModelRegistry` + serialized lane), 2b (`dispatch:"auto"`)

## The win (measured)

A persistent per-session prompt cache, **fed only the new-token delta**, skips
reprocessing the shared context each turn:

| Reused context | per-turn (no cache) | per-turn (cache) | speedup |
|---|---|---|---|
| ~1.2k tok | ~955 ms | ~212 ms | **4.5×** |
| ~10.8k tok | ~9.5 s | ~277 ms | **34×** |

Biggest for long-lived sessions over a large reused prefix (RAG context, long
system prompt, multi-turn chat). Below ~1k tokens: skip it (decode-dominated).

## Design — registry-side, transparent to callers

The coordinator calls are **stateless full-prompt** today and should stay that
way (callers keep sending the full prompt). The registry makes reuse transparent:

```
ModelRegistry (per session_id, under the lane):
  SessionCache { mlx prompt_cache, std::vector<int> cached_token_ids, last_used }

generate[_stream](agent, session_id, full_prompt, max_tokens):
  toks = tokenize(full_prompt)
  sc   = session_caches[session_id]            // create on miss
  lcp  = longest_common_prefix(sc.cached_token_ids, toks)
  if (toks.size() - lcp) < REUSE_MIN_DELTA_CTX // size gate
        → fall back to today's fresh-cache path (no session cache)
  trim sc.prompt_cache back to lcp             // trim_prompt_cache(); divergence-safe
  feed delta = toks[lcp:] into stream_generate(prompt=delta, prompt_cache=sc.prompt_cache)
  sc.cached_token_ids = toks + generated_ids   // extend for next turn
```

**The 2c pitfall is the core correctness risk:** feeding the full prompt into a
non-empty cache double-processes and is *slower*. The longest-common-prefix +
`trim_prompt_cache` step is what makes it correct under branching/edited history.

## Sub-phases (each its own ≤300-LOC PR, default unchanged)

| # | Item | Risk | Exit criterion |
|---|------|------|----------------|
| **2c′-A** | Per-session cache + delta-feed + size gate, behind a config flag (`coordinator.prompt_cache.enabled`, default **off**). `generate`/`generate_stream` take `session_id`. | Med | **MS-161 e2e regression passes** (single-turn unchanged); flag-off byte-identical; multi-turn over a large prefix shows the measured speedup in-coordinator via `/api/mlx/stream`. |
| **2c′-B** | Eviction + memory: LRU/idle eviction of session caches (alongside model eviction); optional `QuantizedKVCache`; surface cache count + est. bytes on `/api/mlx/pressure`. | Med | caches evict on session clear/idle; pressure reports cache memory; no unbounded growth under soak. |

## Risks & constraints

- **Correctness > speed** — wrong delta math = slower or garbage output (the 2c
  pitfall). A unit test on the LCP/trim logic + an in-coordinator multi-turn e2e
  are mandatory before merge.
- Memory: each session cache holds KV for its full context; eviction (2c′-B) is
  required before this is safe for many concurrent sessions. Ship 2c′-A behind
  an off-by-default flag so it can't regress memory until 2c′-B lands.
- Serialized lane already serializes generation — session-cache access is under
  the same lane, so no extra concurrency surface.
- Reuses MLX's prompt-cache API (`make_prompt_cache`/`trim_prompt_cache`); does
  not reimplement caching (the lesson from 2c/2d).

## Recommended order & effort

**2c′-A first** (the win, behind a flag), gated on the regression + a measured
multi-turn e2e; then **2c′-B** (eviction/memory) before the flag flips on by
default. ~5–8 pts total.
