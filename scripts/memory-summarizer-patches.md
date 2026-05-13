# memory-summarizer agent — variant patches

Scenario A (piggyback on `llama8b`) is already applied to `swarm-config.json`.

These patches add the summarizer to the 16 GB and 32 GB variants with
isolation, since those variants have headroom for a dedicated process.

## Scenario B — swarm-config-16gb.json (isolated llama-server)

Download once:

```bash
mkdir -p /Users/Shared/llama/models/GGUF
huggingface-cli download bartowski/Llama-3.2-1B-Instruct-GGUF \
  Llama-3.2-1B-Instruct-Q5_K_M.gguf \
  --local-dir /Users/Shared/llama/models/GGUF
```

Then append to the agents array in `swarm-config-16gb.json` (before the
closing `]`):

```json
,
{
  "name": "memory-summarizer",
  "port": 8089,
  "server_group": "summarizer",
  "backend": "llama",
  "model": "/Users/Shared/llama/models/GGUF/Llama-3.2-1B-Instruct-Q5_K_M.gguf",
  "context": 4096,
  "gpu_layers": 99,
  "read_timeout_secs": 60,
  "max_tokens": 512,
  "system_prompt": "(overridden at call time — see memory_state.cpp)"
}
```

Cost: ~900 MB VRAM, one extra llama-server on port 8089.

## Scenario C — swarm-config-32gb.json (isolated MLX)

Download once:

```bash
huggingface-cli download mlx-community/Llama-3.2-1B-Instruct-4bit \
  --local-dir /Users/Shared/llama/models/MLX/Llama-3.2-1B-Instruct-4bit
```

Then append to the agents array in `swarm-config-32gb.json` (before the
closing `]`):

```json
,
{
  "name": "memory-summarizer",
  "port": 8089,
  "server_group": "summarizer-mlx",
  "backend": "mlx",
  "model": "/Users/Shared/llama/models/MLX/Llama-3.2-1B-Instruct-4bit",
  "context": 4096,
  "gpu_layers": 0,
  "read_timeout_secs": 90,
  "max_tokens": 512,
  "system_prompt": "(overridden at call time — see memory_state.cpp)"
}
```

Cost: ~700 MB VRAM, one extra mlx_lm.server on port 8089.

Dedicated port is the key detail — `init_mlx_port_locks` installs a mutex
per port, so the summarizer worker won't contend with any user agents on
other mlx ports.

## Why not patch all three variants the same way

- `swarm-config.json` (default/8 GB profile): scarce VRAM, piggyback is
  the only sensible choice — A.
- `swarm-config-16gb.json`: middle ground, isolated llama-server gives
  the best latency-per-MB and works regardless of how the rest of the
  swarm is configured — B.
- `swarm-config-32gb.json`: plenty of VRAM, all-MLX or hybrid; isolated
  MLX summarizer avoids the per-port mutex problem — C.

## Scenario D — disable summarization

Don't add the agent. The memory module still appends and persists; only
compression is skipped. To silence the per-attempt log line, in
`memory_state.h` change the default `summarizer_agent` to `""`, then in
`memory_state.cpp::worker_loop` add an early `cancel_pending` + continue
when the name is empty.
