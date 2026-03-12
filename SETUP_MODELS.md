# Model and llama.cpp Setup Guide

This guide covers installing llama.cpp and downloading GGUF models for Matrix Swarm.

## Directory Structure

All models and the llama-server binary live under a shared location:

```
/Users/Shared/llama/
├── llama-server                              # Server binary (used by proxy.mjs)
├── models/
│   ├── Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
│   ├── Llama-3.2-3B-Instruct-Q4_K_M.gguf
│   ├── granite-3.1-8b-instruct-Q4_K_M.gguf
│   ├── gemma-2-2b-it-Q4_K_M.gguf
│   └── ...                                   # Any additional .gguf files
└── llama.cpp/                                # Source repo (optional — for rebuilding)
```

The proxy (`proxy.mjs`) looks for:
- **Binary:** `/Users/Shared/llama/llama-server`
- **Models:** `/Users/Shared/llama/models/*.gguf`

---

## Initial Setup

### 1. Create the shared directory

```bash
sudo mkdir -p /Users/Shared/llama/models
sudo chown $(whoami):staff /Users/Shared/llama
chmod -R 755 /Users/Shared/llama
```

### 2. Build llama.cpp (get llama-server)

Clone and build with Metal acceleration (Apple Silicon):

```bash
cd /Users/Shared/llama
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
mkdir build && cd build
cmake .. -DLLAMA_METAL=on -DLLAMA_NATIVE=on
cmake --build . --config Release -j 8
```

Copy the server binary to the expected location:

```bash
cp /Users/Shared/llama/llama.cpp/build/bin/llama-server /Users/Shared/llama/llama-server
chmod +x /Users/Shared/llama/llama-server
```

### 3. Download model files

Download GGUF models to `/Users/Shared/llama/models/`. The default swarm uses:

| Model file | Size | Used by |
|-----------|------|---------|
| `Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf` | ~5 GB | architect, programmer, debugger |
| `Llama-3.2-3B-Instruct-Q4_K_M.gguf` | ~2 GB | scout, reviewer, tester, devops, database, api |
| `granite-3.1-8b-instruct-Q4_K_M.gguf` | ~5 GB | specialist, security, optimizer |
| `gemma-2-2b-it-Q4_K_M.gguf` | ~1.5 GB | synthesis, documenter, frontend |

Using `huggingface-cli`:

```bash
cd /Users/Shared/llama/models

# Meta Llama 3.1 8B
huggingface-cli download bartowski/Meta-Llama-3.1-8B-Instruct-GGUF \
  Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf --local-dir .

# Llama 3.2 3B
huggingface-cli download bartowski/Llama-3.2-3B-Instruct-GGUF \
  Llama-3.2-3B-Instruct-Q4_K_M.gguf --local-dir .

# IBM Granite 3.1 8B
huggingface-cli download bartowski/granite-3.1-8b-instruct-GGUF \
  granite-3.1-8b-instruct-Q4_K_M.gguf --local-dir .

# Gemma 2 2B
huggingface-cli download bartowski/gemma-2-2b-it-GGUF \
  gemma-2-2b-it-Q4_K_M.gguf --local-dir .
```

### 4. Verify setup

```bash
# Binary is executable
/Users/Shared/llama/llama-server --version

# Models are in place
ls -lh /Users/Shared/llama/models/*.gguf
```

---

## Adding New Models

1. Download the `.gguf` file to `/Users/Shared/llama/models/`
2. It will automatically appear in the **CONFIGURE** panel model picker (the proxy scans the directory on every `/api/models` request)
3. Optionally register it in `mlx_models.json` for reference

---

## Updating llama.cpp

```bash
cd /Users/Shared/llama/llama.cpp
git pull
cd build
cmake --build . --config Release -j 8
cp bin/llama-server /Users/Shared/llama/llama-server
```

Restart the swarm after updating (`bash scripts/shutdown_matrix.sh`, then `bash scripts/launch_matrix.sh`).

---

## Troubleshooting

### Permission errors

```bash
sudo chown -R $(whoami):staff /Users/Shared/llama
chmod -R 755 /Users/Shared/llama
```

### Binary not found

```bash
ls -lh /Users/Shared/llama/llama-server
```

If missing, rebuild following step 2 above.

### Models not appearing in the UI

```bash
ls /Users/Shared/llama/models/*.gguf
```

The proxy scans this directory — any `.gguf` file appears automatically.

### Port already in use

```bash
bash scripts/shutdown_matrix.sh
# Then relaunch
bash scripts/launch_matrix.sh
```

Or manually:

```bash
pkill -f llama-server
lsof -ti:8080,8081,8082,8083,8084 | xargs kill -9
```

### Servers fail health check (timeout during LAUNCH SWARM)

Large models on first load can take 60–90 s. The proxy waits up to 120 s. If it still times out:
- Check `logs/8080.log` (or whichever port) for llama-server errors
- Verify enough free RAM/VRAM for the selected model set
- Try a smaller agent selection (fewer parallel slots = less VRAM)
