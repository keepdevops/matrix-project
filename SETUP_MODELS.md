# Model and llama.cpp / MLX Setup Guide

This guide covers two inference backends supported by Matrix Swarm:

| Backend | Binary | Model format | Best for |
|---------|--------|-------------|---------|
| **llama.cpp** | `llama-server` | `.gguf` files | Broad model support, VRAM control |
| **MLX** | `mlx_lm.server` (Python) | HuggingFace directories | Apple Silicon native speed |

Both serve the same OpenAI-compatible API — the proxy auto-detects which to launch based on the model path (`.gguf` → llama, directory → MLX).

## Directory Structure

Both GGUF files and MLX model directories live in the same folder. The proxy distinguishes them automatically (`.gguf` file → llama-server, directory with `config.json` → mlx_lm.server).

```
/Users/Shared/llama/
├── llama-server                              # llama.cpp server binary
├── llama.cpp/                                # Source repo (optional)
└── models/
    ├── Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf   # GGUF models (files)
    ├── Llama-3.2-3B-Instruct-Q4_K_M.gguf
    ├── granite-3.1-8b-instruct-Q4_K_M.gguf
    ├── gemma-2-2b-it-Q4_K_M.gguf
    ├── Meta-Llama-3.1-8B-Instruct-4bit/          # MLX models (directories)
    │   ├── config.json
    │   ├── tokenizer.json
    │   └── *.safetensors
    ├── Llama-3.2-3B-Instruct-4bit/
    └── ...
```

The proxy (`proxy.mjs`) looks for:
- **llama-server binary:** `/Users/Shared/llama/llama-server`
- **GGUF models:** `*.gguf` files in `/Users/Shared/llama/models/`
- **MLX models:** subdirectories in `/Users/Shared/llama/models/` that contain a `config.json`

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

**GGUF model:**
1. Download the `.gguf` file to `/Users/Shared/llama/models/`
2. It appears automatically in the CONFIGURE panel on next page load

**MLX model:**
1. Download the model directory to `/Users/Shared/llama/models/<model-name>/`
   (must contain `config.json`)
2. It appears automatically in the CONFIGURE panel labelled `[mlx]`

Optionally register either type in `mlx_models.json` for reference.

---

## Converting models (use with llama or mlx-lm on M3)

You can convert a HuggingFace model once and then use it with **either** llama-server (GGUF) or mlx_lm.server (MLX 4-bit) on Apple Silicon (M3 etc.).

The script `scripts/convert_models.sh` supports two targets:

| Target | Output | Use in Matrix |
|--------|--------|----------------|
| **mlx** | MLX 4-bit directory under `models/` | Engine **MLX** — often faster per-token on M-series |
| **gguf** | GGUF file in `models/` | Engine **LLAMA** — same-model parallelism, CLEAR KV |

### Prerequisites

- **For MLX:** `pip install mlx-lm`
- **For GGUF:** A clone of [llama.cpp](https://github.com/ggerganov/llama.cpp) with Python deps (e.g. `pip install -r requirements.txt`). Set `LLAMA_CPP_DIR` if not using `/Users/Shared/llama/llama.cpp`.

### Convert to MLX 4-bit (for mlx-lm on M3)

From the project root:

```bash
# HF repo → MLX 4-bit in /Users/Shared/llama/models/<name>/
./scripts/convert_models.sh mlx meta-llama/Meta-Llama-3.2-3B-Instruct
./scripts/convert_models.sh mlx mistralai/Mistral-7B-Instruct-v0.3 Mistral-7B-Instruct-v0.3-4bit
```

Output appears in CONFIGURE under engine **MLX**. No separate download of pre-converted mlx-community models needed if you have the HF repo.

### Convert to GGUF (for llama-server on M3)

From the project root (requires `LLAMA_CPP_DIR` if llama.cpp is elsewhere):

```bash
export LLAMA_CPP_DIR=/Users/Shared/llama/llama.cpp   # optional if already there

# HF repo → GGUF (f16); then optionally quantize for smaller/faster
./scripts/convert_models.sh gguf meta-llama/Meta-Llama-3.2-3B-Instruct
```

The script prints the exact `llama-quantize` command to produce a Q4_K_M file for lower VRAM and faster inference on M3.

### Custom model directory

Override the models directory:

```bash
export MATRIX_MODELS_DIR=/path/to/models
./scripts/convert_models.sh mlx your-org/your-model
```

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
ls /Users/Shared/llama/models/
```

The proxy scans this single directory — `.gguf` files appear as llama models and subdirectories containing `config.json` appear as MLX models (`[mlx]` label in the picker).

### Port already in use

```bash
bash scripts/shutdown_matrix.sh
# Then relaunch
bash scripts/launch_matrix.sh
```

Or manually:

```bash
pkill -f llama-server
pkill -f "mlx_lm.server"
lsof -ti:8080,8081,8082,8083,8084 | xargs kill -9
```

### Servers fail health check (timeout during LAUNCH SWARM)

Large models on first load can take 60–90 s. The proxy waits up to 120 s. If it still times out:
- Check `logs/8080.log` (or whichever port) for server errors
- Verify enough free RAM/VRAM for the selected model set
- Try a smaller agent selection (fewer parallel slots = less VRAM)

---

## MLX Setup

MLX runs models natively on Apple Silicon using the Metal GPU. It can be significantly faster than llama.cpp for some models.

### 1. Install mlx-lm

```bash
pip install mlx-lm
```

Or with pixi/conda:
```bash
pip install mlx-lm   # inside your active environment
```

### 2. Download MLX models

MLX models are downloaded as HuggingFace model directories into the same `/Users/Shared/llama/models/` folder as GGUF files. The `mlx-community` organization maintains pre-converted 4-bit quantized versions of popular models:

```bash
cd /Users/Shared/llama/models

# Meta Llama 3.1 8B (4-bit)
huggingface-cli download mlx-community/Meta-Llama-3.1-8B-Instruct-4bit \
  --local-dir Meta-Llama-3.1-8B-Instruct-4bit

# Llama 3.2 3B (4-bit)
huggingface-cli download mlx-community/Llama-3.2-3B-Instruct-4bit \
  --local-dir Llama-3.2-3B-Instruct-4bit

# Gemma 2 2B (4-bit)
huggingface-cli download mlx-community/gemma-2-2b-it-4bit \
  --local-dir gemma-2-2b-it-4bit

# Mistral 7B (4-bit)
huggingface-cli download mlx-community/Mistral-7B-Instruct-v0.3-4bit \
  --local-dir Mistral-7B-Instruct-v0.3-4bit
```

Each model is a directory containing `config.json`, `tokenizer.json`, and weight shards (`.safetensors`).

### 3. Verify

```bash
# List all models (GGUF files + MLX directories)
ls /Users/Shared/llama/models/

# Test the MLX server manually
python -m mlx_lm.server \
  --model /Users/Shared/llama/models/Llama-3.2-3B-Instruct-4bit \
  --port 8099
# In another terminal:
curl http://127.0.0.1:8099/health
```

### Using MLX models in the UI

MLX models appear in the CONFIGURE panel model picker labelled `[mlx]`. Assign one to any agent and click **LAUNCH SWARM** — the proxy detects the directory path (no `.gguf` extension) and launches `mlx_lm.server` automatically.

**Notes:**
- MLX agents assigned the same model still share one server instance (requests queue on that server)
- The CLEAR KV button has no effect on MLX servers (MLX manages its own context window)
- MLX and llama-server agents can coexist in the same swarm
