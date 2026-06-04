#!/usr/bin/env python3
"""MS-68 2c spike — measure mlx_lm prompt-cache reuse vs reprocessing.

The 2c stub envisioned a custom Metal-backed paged KV cache. mlx_lm already
owns the KV-cache layer (KVCache / RotatingKVCache / QuantizedKVCache /
LRUPromptCache / PromptTrie + make_prompt_cache). This probe measures the only
reuse mechanism that actually applies in-process: a persistent per-session
prompt cache fed token deltas, versus reprocessing the full context each turn.

Run inside the MLX env:
    $MLX_ENV/bin/python3 scripts/mlx_prompt_cache_probe.py [model_path] [ctx_repeat]

Prints per-turn timings + steady-state speedup. The win scales with reused
context size: negligible/negative for small prompts (decode-dominated),
large for long reused contexts (prefill-dominated).
"""
import sys
import time

import mlx_lm
from mlx_lm.models.cache import make_prompt_cache

MODEL = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/caribou/llama-models/Llama-3.2-3B-Instruct-4bit"
CTX_REPEAT = int(sys.argv[2]) if len(sys.argv) > 2 else 900


def main() -> int:
    model, tok = mlx_lm.load(MODEL)
    mlx_lm.generate(model, tok, prompt="hi", max_tokens=4, verbose=False)  # warm

    ctx = "You are an assistant. " + \
        ("Reference paragraph 0: lorem ipsum dolor sit amet consectetur. " * CTX_REPEAT)
    deltas = [" \nUser: Q1?\nAssistant:", " \nUser: Q2?\nAssistant:",
              " \nUser: Q3?\nAssistant:"]
    n_ctx = len(tok.encode(ctx))
    print(f"model={MODEL}")
    print(f"reused context tokens={n_ctx}\n")

    def gen(prompt, cache, mt=12):
        t = time.perf_counter()
        mlx_lm.generate(model, tok, prompt=prompt, max_tokens=mt,
                        verbose=False, prompt_cache=cache)
        return time.perf_counter() - t

    print("[no reuse] reprocess full context each turn:")
    tot_nr = 0.0
    for i, d in enumerate(deltas):
        dt = gen(ctx + d, make_prompt_cache(model))
        tot_nr += dt
        print(f"  turn{i+1} {dt*1000:7.0f} ms")

    print("\n[reuse] prime once, then feed only deltas:")
    shared = make_prompt_cache(model)
    prime = gen(ctx, shared, mt=1)
    print(f"  prime (one-time) {prime*1000:7.0f} ms")
    tot_r = 0.0
    for i, d in enumerate(deltas):
        dt = gen(d, shared)
        tot_r += dt
        print(f"  turn{i+1} {dt*1000:7.0f} ms (delta only)")

    nr, r = tot_nr / 3, tot_r / 3
    print(f"\nsteady-state per-turn: no-reuse {nr*1000:.0f}ms  vs  reuse {r*1000:.0f}ms")
    if r > 0:
        print(f"steady-state speedup: {nr/r:.2f}x")
    print(f"3-turn total incl. prime: no-reuse {tot_nr*1000:.0f}ms  "
          f"vs reuse {(prime+tot_r)*1000:.0f}ms")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
