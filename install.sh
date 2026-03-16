#!/bin/bash
# Matrix Swarm — Installation Script
# Installs all dependencies, builds binaries, and sets up the model directory.
# Run from the project root: bash install.sh
# Safe to re-run (idempotent where possible).

set -euo pipefail

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'
BLU='\033[0;34m'; CYN='\033[0;36m'; WHT='\033[1;37m'; RST='\033[0m'

banner() { echo -e "\n${BLU}════════════════════════════════════════${RST}"; \
           echo -e "${WHT}  $1${RST}"; \
           echo -e "${BLU}════════════════════════════════════════${RST}"; }
ok()     { echo -e "  ${GRN}✔${RST}  $1"; }
info()   { echo -e "  ${CYN}→${RST}  $1"; }
warn()   { echo -e "  ${YLW}⚠${RST}  $1"; }
fail()   { echo -e "  ${RED}✘${RST}  $1"; }
step()   { echo -e "\n${WHT}[$1]${RST} $2"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL_DIR="/Users/Shared/llama/models"
LLAMA_DIR="/Users/Shared/llama"
LLAMA_BIN="$LLAMA_DIR/llama-server"

# ─── Banner ───────────────────────────────────────────────────────────────────
echo -e "${GRN}"
cat << 'EOF'
  ███╗   ███╗ █████╗ ████████╗██████╗ ██╗██╗  ██╗
  ████╗ ████║██╔══██╗╚══██╔══╝██╔══██╗██║╚██╗██╔╝
  ██╔████╔██║███████║   ██║   ██████╔╝██║ ╚███╔╝
  ██║╚██╔╝██║██╔══██║   ██║   ██╔══██╗██║ ██╔██╗
  ██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║██║██╔╝ ██╗
  ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
              S W A R M  v1.0
EOF
echo -e "${RST}"
echo -e "  Multi-agent LLM swarm installer"
echo -e "  Project: ${SCRIPT_DIR}"
echo

# ─── 1. System Requirements ───────────────────────────────────────────────────
banner "1/8  System Requirements"

# macOS only
if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "Matrix Swarm requires macOS. Detected: $(uname -s)"
    exit 1
fi
ok "macOS detected: $(sw_vers -productVersion)"

# Architecture
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
    ok "Apple Silicon ($ARCH) — Metal GPU acceleration available"
else
    warn "Intel Mac ($ARCH) — Metal acceleration not available; GGUF inference will use CPU only"
fi

# RAM check (require ≥ 8 GB)
TOTAL_RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
if (( TOTAL_RAM_GB < 8 )); then
    fail "Minimum 8 GB RAM required. Detected: ${TOTAL_RAM_GB} GB"
    exit 1
elif (( TOTAL_RAM_GB < 16 )); then
    warn "Detected ${TOTAL_RAM_GB} GB RAM — recommended 16 GB+ for full 16-agent swarm"
else
    ok "RAM: ${TOTAL_RAM_GB} GB"
fi

# Disk space check (20 GB free recommended for models)
FREE_GB=$(( $(df -k / | awk 'NR==2{print $4}') / 1024 / 1024 ))
if (( FREE_GB < 5 )); then
    fail "Less than 5 GB free disk space. Models require 5–20 GB."
    exit 1
elif (( FREE_GB < 20 )); then
    warn "Only ${FREE_GB} GB free — recommended 20 GB+ for all default models"
else
    ok "Disk space: ${FREE_GB} GB free"
fi

# ─── 2. Homebrew ──────────────────────────────────────────────────────────────
banner "2/8  Homebrew"

if command -v brew &>/dev/null; then
    ok "Homebrew already installed: $(brew --version | head -1)"
else
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add to PATH for the rest of this script
    if [[ "$ARCH" == "arm64" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        eval "$(/usr/local/bin/brew shellenv)"
    fi
    ok "Homebrew installed"
fi

# cmake required for llama.cpp build
if ! command -v cmake &>/dev/null; then
    info "Installing cmake..."
    brew install cmake
    ok "cmake installed"
else
    ok "cmake: $(cmake --version | head -1)"
fi

# git is always required
if ! command -v git &>/dev/null; then
    info "Installing git..."
    brew install git
    ok "git installed"
else
    ok "git: $(git --version)"
fi

# ─── 3. Pixi (Node + Python + C++ compiler) ───────────────────────────────────
banner "3/8  Pixi (Node.js · Python · C++ Compiler)"

if ! command -v pixi &>/dev/null; then
    info "Installing pixi..."
    curl -fsSL https://pixi.sh/install.sh | bash
    # Reload PATH
    export PATH="$HOME/.pixi/bin:$PATH"
    ok "pixi installed: $(pixi --version)"
else
    ok "pixi: $(pixi --version)"
fi

step "3a" "Running pixi install (Node.js ≥18, Python ≥3.10, cxx-compiler)..."
cd "$SCRIPT_DIR"
pixi install
ok "pixi environment ready"

# Verify Node.js
NODE_VER=$(pixi run node --version 2>/dev/null || echo "not found")
ok "Node.js: $NODE_VER"

# Verify Python
PY_VER=$(pixi run python --version 2>/dev/null || echo "not found")
ok "Python: $PY_VER"

# ─── 4. npm Dependencies ──────────────────────────────────────────────────────
banner "4/8  Node.js Dependencies (npm install)"

cd "$SCRIPT_DIR"
if [[ -d node_modules ]]; then
    info "node_modules exists — running npm install to ensure up-to-date..."
fi
pixi run npm install
ok "npm packages installed"

# ─── 5. Build Coordinator (C++) ───────────────────────────────────────────────
banner "5/8  Build Coordinator (C++17)"

cd "$SCRIPT_DIR"
if [[ -f coordinator && coordinator -nt coordinator.cpp ]]; then
    ok "coordinator binary is up-to-date (skipping rebuild)"
else
    info "Compiling coordinator.cpp..."
    pixi run c++ -std=c++17 -O2 -o coordinator coordinator.cpp -pthread
    ok "coordinator binary built: $SCRIPT_DIR/coordinator"
fi

# ─── 6. Shared Model Directory ────────────────────────────────────────────────
banner "6/8  Shared Model Directory"

if [[ ! -d "$MODEL_DIR" ]]; then
    info "Creating $LLAMA_DIR ..."
    sudo mkdir -p "$MODEL_DIR"
    sudo chown "$(whoami):staff" "$LLAMA_DIR"
    chmod -R 755 "$LLAMA_DIR"
    ok "Created $MODEL_DIR"
else
    ok "$MODEL_DIR already exists"
    # Ensure we own it
    if [[ ! -w "$MODEL_DIR" ]]; then
        info "Fixing permissions on $LLAMA_DIR ..."
        sudo chown -R "$(whoami):staff" "$LLAMA_DIR"
        chmod -R 755 "$LLAMA_DIR"
        ok "Permissions fixed"
    fi
fi

# List any models already present
GGUF_COUNT=$(find "$MODEL_DIR" -maxdepth 1 -name "*.gguf" 2>/dev/null | wc -l | tr -d ' ')
MLX_COUNT=$(find "$MODEL_DIR" -maxdepth 1 -mindepth 1 -type d -exec test -f '{}/config.json' \; -print 2>/dev/null | wc -l | tr -d ' ')
info "Models found: ${GGUF_COUNT} GGUF files, ${MLX_COUNT} MLX directories"

# ─── 7. llama.cpp (llama-server binary) ───────────────────────────────────────
banner "7/8  llama.cpp / llama-server"

if [[ -x "$LLAMA_BIN" ]]; then
    ok "llama-server already installed: $LLAMA_BIN"
    info "Run '$LLAMA_BIN --version' to check version"
    info "To rebuild: cd $LLAMA_DIR/llama.cpp && cd build && cmake --build . --config Release -j 8"
else
    echo
    echo -e "  ${YLW}llama-server not found at $LLAMA_BIN${RST}"
    echo
    echo    "  llama-server is required for GGUF model inference."
    echo    "  It is built from source (llama.cpp) with Metal acceleration."
    echo
    echo    "  Options:"
    echo    "    a) Build now  — clones llama.cpp and compiles (~5-10 min)"
    echo    "    s) Skip       — you can build it manually later (see SETUP_MODELS.md)"
    echo
    read -rp "  Choice [a/s]: " LLAMA_CHOICE
    echo

    if [[ "${LLAMA_CHOICE,,}" == "a" ]]; then
        LLAMA_SRC="$LLAMA_DIR/llama.cpp"

        if [[ -d "$LLAMA_SRC/.git" ]]; then
            info "llama.cpp source already cloned — pulling latest..."
            git -C "$LLAMA_SRC" pull --ff-only || warn "git pull failed (local changes?), continuing with existing source"
        else
            info "Cloning llama.cpp into $LLAMA_SRC ..."
            git clone https://github.com/ggerganov/llama.cpp "$LLAMA_SRC"
        fi

        info "Configuring with cmake (Metal enabled)..."
        mkdir -p "$LLAMA_SRC/build"
        if [[ "$ARCH" == "arm64" ]]; then
            cmake -S "$LLAMA_SRC" -B "$LLAMA_SRC/build" \
                -DLLAMA_METAL=on -DLLAMA_NATIVE=on -DCMAKE_BUILD_TYPE=Release
        else
            cmake -S "$LLAMA_SRC" -B "$LLAMA_SRC/build" \
                -DCMAKE_BUILD_TYPE=Release
        fi

        info "Building llama-server (using $(sysctl -n hw.logicalcpu) cores)..."
        cmake --build "$LLAMA_SRC/build" --config Release -j "$(sysctl -n hw.logicalcpu)"

        info "Installing llama-server binary to $LLAMA_BIN ..."
        cp "$LLAMA_SRC/build/bin/llama-server" "$LLAMA_BIN"
        chmod +x "$LLAMA_BIN"
        ok "llama-server installed: $LLAMA_BIN"
        "$LLAMA_BIN" --version 2>/dev/null || true
    else
        warn "Skipped — build llama-server manually before launching the swarm"
        info "See SETUP_MODELS.md for instructions"
    fi
fi

# ─── 8. Model Downloads (optional) ────────────────────────────────────────────
banner "8/8  Model Downloads (optional)"

echo    "  The default swarm uses four GGUF models (~14 GB total):"
echo
echo    "    Model                                  Size   Used by"
echo    "    ─────────────────────────────────────  ─────  ───────────────────────────"
echo    "    Meta-Llama-3.1-8B-Instruct-Q4_K_M      ~5 GB  architect, programmer, debugger"
echo    "    Llama-3.2-3B-Instruct-Q4_K_M           ~2 GB  scout, reviewer, tester, devops"
echo    "    granite-3.1-8b-instruct-Q4_K_M         ~5 GB  specialist, security, optimizer"
echo    "    gemma-2-2b-it-Q4_K_M                   ~1.5 GB synthesis, documenter, frontend"
echo

# Check what's already present
LLAMA31_8B="$MODEL_DIR/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
LLAMA32_3B="$MODEL_DIR/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
GRANITE_8B="$MODEL_DIR/granite-3.1-8b-instruct-Q4_K_M.gguf"
GEMMA_2B="$MODEL_DIR/gemma-2-2b-it-Q4_K_M.gguf"

MODEL_STATUS=()
[[ -f "$LLAMA31_8B" ]] && MODEL_STATUS+=("${GRN}✔${RST} Llama-3.1-8B") || MODEL_STATUS+=("  Llama-3.1-8B")
[[ -f "$LLAMA32_3B" ]] && MODEL_STATUS+=("${GRN}✔${RST} Llama-3.2-3B") || MODEL_STATUS+=("  Llama-3.2-3B")
[[ -f "$GRANITE_8B" ]] && MODEL_STATUS+=("${GRN}✔${RST} Granite-3.1-8B") || MODEL_STATUS+=("  Granite-3.1-8B")
[[ -f "$GEMMA_2B"   ]] && MODEL_STATUS+=("${GRN}✔${RST} Gemma-2-2B") || MODEL_STATUS+=("  Gemma-2-2B")

echo -e "  Current status:  ${MODEL_STATUS[0]}   ${MODEL_STATUS[1]}   ${MODEL_STATUS[2]}   ${MODEL_STATUS[3]}"
echo

ALL_PRESENT=true
for f in "$LLAMA31_8B" "$LLAMA32_3B" "$GRANITE_8B" "$GEMMA_2B"; do
    [[ -f "$f" ]] || ALL_PRESENT=false
done

if $ALL_PRESENT; then
    ok "All default models already downloaded"
else
    echo    "  Download methods:"
    echo    "    h) huggingface-cli  — fastest; requires: pip install huggingface_hub"
    echo    "    c) curl             — no account needed; slower, resumable"
    echo    "    s) Skip             — download manually later (see SETUP_MODELS.md)"
    echo
    read -rp "  Choice [h/c/s]: " DL_CHOICE
    echo

    case "${DL_CHOICE,,}" in
        h)
            # Install huggingface_hub if needed
            if ! pixi run python -c "import huggingface_hub" 2>/dev/null; then
                info "Installing huggingface_hub..."
                pixi run pip install huggingface_hub
            fi
            HF_CLI="pixi run huggingface-cli"

            echo    "  Select models to download (leave blank to download all missing):"
            echo    "    1) Meta-Llama-3.1-8B-Instruct-Q4_K_M (~5 GB)"
            echo    "    2) Llama-3.2-3B-Instruct-Q4_K_M       (~2 GB)"
            echo    "    3) granite-3.1-8b-instruct-Q4_K_M      (~5 GB)"
            echo    "    4) gemma-2-2b-it-Q4_K_M                (~1.5 GB)"
            echo    "    a) All missing models"
            echo
            read -rp "  Selection [1/2/3/4/a — comma-separated]: " DL_SEL
            [[ -z "$DL_SEL" ]] && DL_SEL="a"

            dl_gguf() {
                local repo="$1" file="$2" dest="$3"
                if [[ -f "$dest" ]]; then
                    ok "Already exists: $(basename "$dest") — skipping"
                else
                    info "Downloading $(basename "$dest") from $repo ..."
                    $HF_CLI download "$repo" "$file" --local-dir "$MODEL_DIR"
                    ok "Downloaded: $(basename "$dest")"
                fi
            }

            download_all_missing() {
                [[ -f "$LLAMA31_8B" ]] || dl_gguf "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF" \
                    "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" "$LLAMA31_8B"
                [[ -f "$LLAMA32_3B" ]] || dl_gguf "bartowski/Llama-3.2-3B-Instruct-GGUF" \
                    "Llama-3.2-3B-Instruct-Q4_K_M.gguf" "$LLAMA32_3B"
                [[ -f "$GRANITE_8B" ]] || dl_gguf "bartowski/granite-3.1-8b-instruct-GGUF" \
                    "granite-3.1-8b-instruct-Q4_K_M.gguf" "$GRANITE_8B"
                [[ -f "$GEMMA_2B"   ]] || dl_gguf "bartowski/gemma-2-2b-it-GGUF" \
                    "gemma-2-2b-it-Q4_K_M.gguf" "$GEMMA_2B"
            }

            IFS=',' read -ra SELECTIONS <<< "$DL_SEL"
            for sel in "${SELECTIONS[@]}"; do
                sel="${sel// /}"
                case "$sel" in
                    1) dl_gguf "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF" \
                           "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" "$LLAMA31_8B" ;;
                    2) dl_gguf "bartowski/Llama-3.2-3B-Instruct-GGUF" \
                           "Llama-3.2-3B-Instruct-Q4_K_M.gguf" "$LLAMA32_3B" ;;
                    3) dl_gguf "bartowski/granite-3.1-8b-instruct-GGUF" \
                           "granite-3.1-8b-instruct-Q4_K_M.gguf" "$GRANITE_8B" ;;
                    4) dl_gguf "bartowski/gemma-2-2b-it-GGUF" \
                           "gemma-2-2b-it-Q4_K_M.gguf" "$GEMMA_2B" ;;
                    a) download_all_missing ;;
                    *) warn "Unknown selection: $sel" ;;
                esac
            done
            ;;

        c)
            dl_curl() {
                local url="$1" dest="$2"
                if [[ -f "$dest" ]]; then
                    ok "Already exists: $(basename "$dest") — skipping"
                else
                    info "Downloading $(basename "$dest") via curl (resumable)..."
                    curl -L -C - -o "$dest" "$url"
                    ok "Downloaded: $(basename "$dest")"
                fi
            }

            BASE="https://huggingface.co"
            [[ -f "$LLAMA31_8B" ]] || dl_curl \
                "$BASE/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" \
                "$LLAMA31_8B"
            [[ -f "$LLAMA32_3B" ]] || dl_curl \
                "$BASE/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf" \
                "$LLAMA32_3B"
            [[ -f "$GRANITE_8B" ]] || dl_curl \
                "$BASE/bartowski/granite-3.1-8b-instruct-GGUF/resolve/main/granite-3.1-8b-instruct-Q4_K_M.gguf" \
                "$GRANITE_8B"
            [[ -f "$GEMMA_2B" ]] || dl_curl \
                "$BASE/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf" \
                "$GEMMA_2B"
            ;;

        s)
            warn "Skipped — download models manually before launching the swarm"
            info "See SETUP_MODELS.md for download commands"
            ;;

        *)
            warn "Invalid choice — skipping model download"
            ;;
    esac
fi

# ─── Optional: MLX ────────────────────────────────────────────────────────────
if [[ "$ARCH" == "arm64" ]]; then
    echo
    echo -e "  ${CYN}Optional: Install MLX backend (Apple Silicon native inference)${RST}"
    echo    "  mlx-lm provides faster per-token throughput on M-series chips."
    echo
    read -rp "  Install mlx-lm now? [y/n]: " MLX_CHOICE
    if [[ "${MLX_CHOICE,,}" == "y" ]]; then
        info "Installing mlx-lm via pixi (mlx environment)..."
        pixi install -e mlx
        ok "MLX environment ready — use 'pixi run -e mlx ...' or select MLX engine in UI"
    else
        info "Skipped — install later with: pixi install -e mlx"
    fi
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
banner "Installation Summary"

check_item() {
    local label="$1" condition="$2"
    if eval "$condition"; then
        ok "$label"
    else
        fail "$label"
    fi
}

check_item "pixi environment"      "pixi run node --version &>/dev/null"
check_item "node_modules"          "[[ -d '$SCRIPT_DIR/node_modules' ]]"
check_item "coordinator binary"    "[[ -x '$SCRIPT_DIR/coordinator' ]]"
check_item "Model directory"       "[[ -d '$MODEL_DIR' ]]"
check_item "llama-server binary"   "[[ -x '$LLAMA_BIN' ]]"

GGUF_FINAL=$(find "$MODEL_DIR" -maxdepth 1 -name "*.gguf" 2>/dev/null | wc -l | tr -d ' ')
MLX_FINAL=$(find "$MODEL_DIR" -maxdepth 1 -mindepth 1 -type d -exec test -f '{}/config.json' \; -print 2>/dev/null | wc -l | tr -d ' ')
info "Models in $MODEL_DIR: ${GGUF_FINAL} GGUF, ${MLX_FINAL} MLX"

echo
echo -e "${GRN}  ✔  Installation complete!${RST}"
echo
echo -e "${WHT}  Next steps:${RST}"
echo    "  1. Launch the swarm:"
echo    "       cd $SCRIPT_DIR"
echo    "       bash scripts/launch_matrix.sh"
echo
echo    "  2. Open the UI:  http://localhost:3000"
echo
echo    "  3. In the UI:"
echo    "       • Click CONFIGURE to select agents and models"
echo    "       • Click LAUNCH SWARM to start the inference servers"
echo    "       • Type a prompt and press Cmd+Enter or BROADCAST"
echo
if [[ ! -x "$LLAMA_BIN" ]]; then
    echo -e "  ${YLW}  ⚠  llama-server is not installed — see SETUP_MODELS.md to build it${RST}"
    echo
fi
if (( GGUF_FINAL == 0 && MLX_FINAL == 0 )); then
    echo -e "  ${YLW}  ⚠  No models found in $MODEL_DIR${RST}"
    echo    "      Download models with: bash scripts/convert_models.sh download <url>"
    echo    "      or re-run: bash install.sh"
    echo
fi
echo    "  Docs:"
echo    "    README.md       — architecture overview"
echo    "    USER_MANUAL.md  — full usage guide"
echo    "    SETUP_MODELS.md — model download & conversion"
echo
