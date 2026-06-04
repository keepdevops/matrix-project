# MS-68 2d — Flash attention spike: findings + NO-GO

**Sub-phase:** 2d (Flash attention) from [ms-68-phase2-scope.md](./ms-68-phase2-scope.md)
**Type:** measured spike · **Date:** 2026-06-03

## Question

Phase 1 left a C++ stub (`flash_attention_wrapper.{h,cpp}`) behind
`MATRIX_FLASH_ATTENTION_ENABLED`, envisioning a Metal flash-attention path with
a fallback. Is there a tok/s win to build for the in-process MLX path?

## What we found

**MLX already runs fused (flash-attention-style) attention, and mlx_lm already
uses it on every token.** Evidence (MLX 0.31.2, mlx_lm 0.31.3):

- `mx.fast.scaled_dot_product_attention` exists — a fused Metal attention
  kernel (the flash-attention equivalent in MLX core).
- `mlx_lm.models.llama.Attention.__call__` calls it directly:
  `output = scaled_dot_product_attention(q, k, v, scale=..., mask=...)`.

So in-process generation is **already** on the fused kernel. A
`FlashAttentionWrapper` in our C++ layer has nothing to wrap — the optimization
lives one level below us, inside MLX/Metal, and is already active.

**No tok/s comparison is offered, by design.** There is no non-fused attention
path in mlx_lm to benchmark against; the only way to produce a "with vs without
flash" number would be to fork mlx_lm and disable its SDPA — out of scope, and
any synthesized delta would be a fabricated number. The honest finding is
qualitative: the kernel is already in the hot path.

## Verdict

- **NO-GO** — there is nothing for us to build. Flash-attention is MLX's
  responsibility and is already used. **Deleted the `flash_attention_wrapper`
  stub** (this PR), together with the `paged_kv_cache` stub (NO-GO per 2c).

## Net result for MS-68 Phase 2 spikes (2c + 2d)

Both "build a custom Metal primitive" ideas were the wrong layer — MLX owns KV
caching *and* fused attention. The one real, measured win uncovered by the
spikes is **session prompt-cache reuse** (2c′), which uses MLX's existing
prompt-cache API rather than competing with it. The dead stubs are removed so
the codebase doesn't imply work that shouldn't happen.
