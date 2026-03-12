# Scripts

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
4. Starts `node proxy.mjs` on port 3002 (logs → `logs/proxy.log`)
5. Starts the React UI on port 3000 (bare metal: `npm start` → `logs/ui.log`; Docker: `docker-compose up -d`)

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
3. Kills any `llama-server`, `coordinator`, and `node proxy.mjs` processes
4. Force-frees ports 3000–3002, 8000–8084
5. Verifies all swarm ports are released

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
