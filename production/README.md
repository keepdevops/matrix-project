# Production deployment (UI)

Swarm Matrix keeps **inference on the host** (Metal / GPU): `llama-server`, `coordinator`, and the **C++ `proxy`** on port **3002**. Only the **React UI** is a good fit for a container.

## Quick install (production)

From the **repository root** (or `bash production/install.sh` from anywhere):

```bash
bash production/install.sh
```

This runs **`scripts/build_coordinator.sh`** (builds `coordinator` and `proxy`), then **`npm ci`**. It **sources** `scripts/matrix-env.sh` when present so `MATRIX_*` is set for later commands.

- **Also build the nginx UI image:**  
  `bash production/install.sh --with-docker`  
  or `MATRIX_PROD_DOCKER=1 bash production/install.sh`

For a **full macOS** setup (Homebrew, pixi, optional `llama-server` build, model downloads), use **`scripts/install.sh`** instead.

## 1. Host: proxy + API

Set paths once (prints suggested defaults for your OS):

```bash
source scripts/matrix-env.sh          # or: eval "$(bash scripts/matrix-env.sh)"
bash scripts/matrix-validate-env.sh   # optional checks
```

From the repo root (after `bash production/install.sh` or `bash scripts/install.sh` and builds as needed):

```bash
./proxy >> logs/proxy.log 2>&1 &
# Configure models from the UI as usual (CONFIGURE → LAUNCH SWARM starts coordinator + servers).
```

`scripts/launch_matrix.sh` **sources** `scripts/matrix-env.sh` automatically so child processes inherit `MATRIX_*`.

## 2. Container: static UI + `/api` → host

Build the UI with the API base set to **`/api`** (nginx forwards `/api` to `host.docker.internal:3002`). Run these from the **repository root**:

```bash
docker compose -f production/docker-compose.prod.yml build --no-cache
docker compose -f production/docker-compose.prod.yml up -d
```

Open **http://localhost** (port 80). The browser calls **`/api/*`**, nginx proxies to the host proxy.

**Linux:** ensure `extra_hosts: host.docker.internal:host-gateway` (already in `production/docker-compose.prod.yml` for Docker 20.10+).

## 3. Environment

| Variable | Where | Purpose |
|----------|--------|---------|
| `REACT_APP_API_BASE` | **Build time** (CRA) | e.g. `/api` for same-origin, or `http://localhost:3002/api` for dev |
| `MATRIX_LAUNCH_MODE` | **Runtime** (shell) | `1` = Docker UI, `2` = bare metal (`scripts/launch_matrix.sh`) |
| `MATRIX_MODEL_DIR` | **Runtime** (proxy) | Directory containing `.gguf` files and MLX model folders |
| `MATRIX_LLAMA_SERVER` | **Runtime** | Path to `llama-server` binary |
| `MATRIX_ACTIVE_CONFIG` | **Runtime** | Active config (default `/tmp/matrix-active-config.json`) |
| `MATRIX_SLOTS_DIR` | **Runtime** | llama-server `--slot-save-path` (default `/tmp/matrix-slots`) |
| `MATRIX_MLX_PYTHON` | **Runtime** | Python for `mlx_lm.server` (defaults to pixi mlx env or `python3`) |
| `MATRIX_PROXY_PORT` | **Runtime** | Proxy listen port (default **3002**). If changed, update **`production/nginx.conf`** `proxy_pass` and React **`REACT_APP_API_BASE`**. |
| `MATRIX_COORDINATOR_PORT` | **Runtime** | Coordinator HTTP port (default **8000**) |
| `MATRIX_COORDINATOR_URL` | **Runtime** | (`proxy.mjs` only) Full coordinator base URL |

Defaults are chosen in **`matrix_env.cpp`** / **`proxy.mjs`** and **`scripts/matrix-env.sh`** (macOS vs Linux-style paths). No rebuild required when only env vars change.

## 4. Coordinator

`coordinator` reads **`swarm-config.json`** paths from the UI; no model root env in the coordinator binary.
