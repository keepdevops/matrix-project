# Matrix Swarm — Setup Guide

Step-by-step instructions to get from a fresh clone to a running swarm.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| macOS (Apple Silicon recommended) | MLX requires Metal / Apple Silicon. Intel Macs can run LLAMA-only swarms. |
| Node ≥ 18 < 23, npm ≥ 9 | `node --version`, `npm --version` |
| C++17 toolchain | `xcode-select --install` (macOS) |
| Python ≥ 3.10 | Used by `brewctl`, orchestration, RAG, and MLX coordinator. |
| `llama-server` on `PATH` | Build from [llama.cpp](https://github.com/ggerganov/llama.cpp) or install via Homebrew. |
| `mlx_lm` (Apple Silicon only) | `pip install mlx-lm` in your active environment. |
| Docker Desktop (vLLM or RAG) | Model Runner for GPU-accelerated vLLM servers; pgvector container for RAG. |
| GGUF or MLX model files | See [Model paths](#model-paths) below. |

---

## 1. Clone and install

```bash
git clone https://github.com/keepdevops/matrix-project.git

brew install prometheus-cpp
brew install libpq

cd matrix-project
npm install
```

---

## 2. Build C++ binaries

```bash
bash scripts/build_cpp_binaries.sh
```

This compiles the **coordinator** (`build/coordinator`) and **proxy** (`build/proxy`) from `cpp_core/src/`. The optional `matrix_config_service` binary is built if CMake finds its sources.

Re-run after any change under `cpp_core/src/`.

---

## 3. Model paths

Agent profiles in `config/agents/*.json` reference models as:

```
"${MATRIX_MODEL_DIR}/path/to/model.gguf"
```

`MATRIX_MODEL_DIR` defaults to `/Users/Shared/llama/models` on macOS. Override:

```bash
export MATRIX_MODEL_DIR=/your/models/root
```

Place GGUF files under that directory. MLX model directories (not single files) go anywhere — set the path explicitly per agent in the UI or in the agent JSON.

The build script (`scripts/build_swarm_config.py`) expands `${MATRIX_MODEL_DIR}` at build time and fails loudly if any variable is unresolved.

---

## 4. Environment defaults (optional)

```bash
source scripts/matrix-env.sh
```

Sets `MATRIX_MODEL_DIR`, `MATRIX_LLAMA_SERVER`, `MATRIX_MLX_PYTHON`, and conda/venv activation if present. Safe to source in your shell profile.

---

## 5. Pre-flight check

```bash
python3 scripts/brewctl check
```

Verifies:
- Required ports are free (3000, 3002, 8000).
- `llama-server` and/or `mlx_lm` binaries are on PATH.
- At least one model file is accessible under `MATRIX_MODEL_DIR`.
- Node / npm versions satisfy requirements.

Fix any reported issues before proceeding.

---

## 6. Generate swarm config

```bash
python3 scripts/build_swarm_config.py
```

Merges `config/coordinator.json` and all `config/agents/*.json` into `swarm-config.json` (and `public/swarm-config.json`). Run after editing any agent file or the coordinator config.

Pre-built variants (`swarm-config-16gb.json`, `swarm-config-32gb.json`, `swarm-config-8agents-text-image.json`) are included — copy one over `swarm-config.json` if it matches your hardware.

---

## 7. Launch

```bash
python3 scripts/brewctl launch
```

Starts:
- **React UI** on `:3000`
- **Node proxy** on `:3002`
- **C++ coordinator** at `:3002` handles MLX agents natively (no separate `:3003` process).

Open `http://localhost:3000` → **CONFIGURE** → choose engine + agents → **LAUNCH SWARM** → wait for ONLINE.

---

## 8. Shutdown

```bash
python3 scripts/brewctl shutdown
```

---

## 9. Conda / Python environment

```bash
conda env update -n mlx-env -f environment.yml
conda activate mlx-env
```

The `environment.yml` pins `mlx-lm`, `pydantic`, `structlog`, `psycopg2`, and other Python dependencies used by the orchestration layer and RAG pipeline.

---

## 10. RAG setup (optional)

```bash
# Start pgvector (convenience wrapper)
bash scripts/rag-docker-compose.sh up

# Index a directory (auto-runs on `brewctl launch` when container is running)
python3 scripts/brewctl rag index ./cpp_core --embedder hash

# Index multiple directories
python3 scripts/brewctl rag index ./cpp_core ./orchestration --embedder hash

# Re-index after code changes
python3 scripts/brewctl rag index . --embedder hash --force

# Query the index
python3 scripts/brewctl rag query "kv router" --embedder hash
python3 scripts/brewctl rag query "session management" --top-k 5 --embedder hash
```

`brewctl launch` auto-indexes when the container is running. Override the DSN with `RAG_DSN=postgresql://...`.

`scripts/rag-docker-compose.sh` subcommands: `up`, `down`, `restart`, `logs`, `status`, `wait` (blocks until `pg_isready`), `psql` (shell into `matrix_rag`), `nuke` (down + volume wipe). Auto-detects `docker compose` vs legacy `docker-compose`.

---

## 11. Optional: config HTTP service

For multi-process or CI setups, run `matrix_config_service` as a shared config store:

```bash
./build/matrix_config_service --config /path/to/swarm-config.json --port 8011
```

Then set `MATRIX_SWARM_CONFIG_SERVICE=http://host:8011` in the coordinator's environment. The coordinator will load config via `GET /api/v1/config` at startup and persist mode/preset edits back via `PUT /api/v1/config`.

---

## 12. Verify

```bash
bash tests/run.sh
```

Runs ~30 integration tests against mock agents (no real models needed, ~30 s). All should pass before deploying to a shared environment.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| UI shows OFFLINE | LAUNCH SWARM not clicked, or coordinator failed to start — check `logs/coordinator.log`. |
| Port already in use | Another process holds the port; `lsof -i :<port>` to find it. |
| `${MATRIX_MODEL_DIR}` unresolved | Export the variable before launching; check `matrix-env.sh`. |
| MLX server not responding | Check `logs/mlx_coordinator.log`; ensure `mlx_lm` is installed in the active Python env. |
| vLLM containers not starting | Open Docker Desktop → Model Runner; verify GPU is available. |
| Build fails: missing headers | Run `xcode-select --install`; ensure `clang++` supports C++17. |
| Tests fail on port reuse | Run `python3 scripts/brewctl shutdown` first, then re-run `bash tests/run.sh`. |
