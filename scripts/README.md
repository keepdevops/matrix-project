# Scripts

## One script to start, one to stop

From the project root:

- **Start** (frontend + backend proxy + optional fan control):  
  `./start.sh`  
  Prompts for Docker or Bare Metal for the UI, then starts the proxy and UI. If present, `scripts/fan_control.sh` is run to enable GPU fan control before startup.

- **Stop** (frontend, backend, agents, coordinator, fan):  
  `./stop.sh`  
  Prompts for Docker or Bare Metal to match how you started, then stops the UI, kills tracked processes and model servers, releases ports, and restores system fan control if `fan_control.sh` was used.

Both scripts delegate to `scripts/launch_matrix.sh` and `scripts/shutdown_matrix.sh`.

---

## launch_matrix.sh

Starts the Node proxy and React UI.

```bash
bash scripts/launch_matrix.sh
```

**Prompts for:**
- **Mode** — `1` Docker (UI runs in a container) or `2` Bare Metal (`npm start`)

**What it does:**
1. Kills any previously tracked PIDs (from `logs/matrix.pids`)
2. Tears down Docker containers if Docker mode was selected
3. Force-frees ports 3000–3002, 8000–8084
4. Optionally runs `fan_control.sh start` (if present) for GPU fan control
5. Starts `node proxy.mjs` on port 3002 (logs → `logs/proxy.log`)
6. Starts the React UI on port 3000 (bare metal: `npm start` → `logs/ui.log`; Docker: `docker-compose up -d`)

After launch, open **http://localhost:3000**, click **CONFIGURE**, select agents and models, then click **LAUNCH SWARM** to deploy the llama-server instances and coordinator from the browser.

---

## shutdown_matrix.sh

Stops all Matrix Swarm processes and frees all ports.

```bash
bash scripts/shutdown_matrix.sh
```

**Prompts for:**
- **Mode** — `1` Docker or `2` Bare Metal (must match how it was launched)

**What it does:**
1. Stops the React UI (`react-scripts stop` or `docker-compose down`)
2. Kills tracked PIDs from `logs/matrix.pids`
3. Kills any `llama-server`, `llama_cpp.server`, `mlx_lm.server`, `coordinator`, and `node proxy.mjs` processes
4. Force-frees ports 3000–3002, 8000–8084
5. Verifies all swarm ports are released
6. Optionally runs `fan_control.sh stop` (if present) to restore system fan control

---

## build_coordinator.sh

Compiles `coordinator.cpp` into the `./coordinator` binary.

```bash
bash scripts/build_coordinator.sh
```

Requires a C++17-capable compiler (`clang++` or `g++`). Run this once after cloning, and again whenever `coordinator.cpp` is modified.

```bash
c++ -std=c++17 -O2 -o coordinator coordinator.cpp -pthread
```

---

## convert_models.sh

Download or convert models for use with llama (GGUF) or mlx-lm (MLX 4-bit) on M3/Apple Silicon.

```bash
./scripts/convert_models.sh download <url> [output_filename]  # curl, any public URL
./scripts/convert_models.sh bartowski <repo> <filename>       # curl from bartowski GGUF repos
./scripts/convert_models.sh mlx <hf_repo> [output_name]        # → MLX 4-bit (pip install mlx-lm)
./scripts/convert_models.sh gguf <hf_repo> [output_name]       # → GGUF (requires LLAMA_CPP_DIR)
```

**Bartowski (GGUF via curl):** Use [bartowski](https://huggingface.co/bartowski)’s quantized GGUF repos. Repo can be `RepoName` or `bartowski/RepoName`; filename is the exact `.gguf` file (e.g. `Llama-3.2-3B-Instruct-Q4_K_M.gguf`). No auth needed.

```bash
./scripts/convert_models.sh bartowski Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q4_K_M.gguf
./scripts/convert_models.sh bartowski Mistral-7B-Instruct-v0.3-GGUF Mistral-7B-Instruct-v0.3-Q4_K_M.gguf
./scripts/convert_models.sh bartowski Qwen2.5-7B-Instruct-GGUF qwen2.5-7b-instruct-q4_k_m.gguf
```

See [SETUP_MODELS.md](../SETUP_MODELS.md#converting-models-use-with-llama-or-mlx-lm-on-m3) for details.

---

## run_matrix_pixi.sh

Runs the Matrix project via pixi: installs the pixi environment, builds the coordinator, then runs the interactive launch.

```bash
./scripts/run_matrix_pixi.sh
```

Requires [pixi](https://pixi.sh) installed. Uses this project’s `pixi.toml` so it won’t pick up a parent folder’s manifest.
