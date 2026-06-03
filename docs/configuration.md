# Configuration

## Swarm config files

| File | Tracked | Purpose |
|------|---------|---------|
| `config/coordinator.json` | yes | Coordinator modes, presets, RAG defaults |
| `config/agents/*.json` | yes | Per-agent source of truth |
| `swarm-config.template.json` | yes | MS-68 starter template (safe defaults) |
| `swarm-config.json` | no (gitignored) | Runtime monolith read by C++ coordinator |
| `public/swarm-config.json` | no | UI static copy from build script |

## MS-68 migration (local setup)

1. **Bootstrap local config** (if you have no `swarm-config.json`):

   ```bash
   bash scripts/setup-config.sh
   ```

2. **Or regenerate from per-agent files** (recommended for development):

   ```bash
   python3 scripts/build_swarm_config.py
   ```

3. **Coordinator fallback order** (file path only; env service unchanged):
   - Path from `--config` (default `swarm-config.json`)
   - Else readable `./swarm-config.json`
   - Else `swarm-config.template.json` (stderr explains copy via `setup-config.sh`)

`MATRIX_SWARM_CONFIG_SERVICE` and `config/` directory layouts skip this fallback.

## MS-68 agent fields (MLX memory foundation)

Optional per-agent keys (defaults preserve existing HTTP dispatch):

| Field | Default | Values |
|-------|---------|--------|
| `dispatch` | `http` | `http`, `inproc` / `inprocess`, `auto` |
| `quant` | (empty → `default` in registry) | e.g. `4bit`, `8bit` |
| `use_flash_attention` | `false` | bool — stub until Phase 2 |
| `inference_backend` | `""` | `auto`, `llama_metal`, `python_mlx` (Cycle 1 routing) |

`inprocess` in JSON is normalized to `inproc` for MS-161 in-process MLX routes.

## Related docs

- [SETUP.md](./SETUP.md) — full install and launch
- [BACKEND_ROUTING.md](./BACKEND_ROUTING.md) — `inference_backend` / `MATRIX_BACKEND_ROUTING`
- [model-management.md](./model-management.md) — MS-161 `dispatch: inproc`
- [sprints/ms-68-sprint.md](./sprints/ms-68-sprint.md) — sprint tracker
