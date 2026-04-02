# Matrix Swarm (minimal dev tree)

This branch contains only what is required to run the app in development.

## Run

1. **Build C++** — `bash scripts/build_coordinator.sh` (produces `coordinator` and `proxy`).
2. **Env (optional)** — `source scripts/matrix-env.sh` or set `MATRIX_*` yourself.
3. **Launch** — `bash scripts/launch_matrix.sh` → choose **2** (bare metal) for `npm start` + `./proxy`.
4. **Stop** — `bash scripts/shutdown_matrix.sh`.

UI: [http://localhost:3000](http://localhost:3000). API proxy listens on **3002**; coordinator on **8000** after you **LAUNCH SWARM** in the UI.

Docker Compose / `production/` nginx UI are **not** included here; add those files locally if you need them.
