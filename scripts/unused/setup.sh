#!/usr/bin/env bash
# =============================================================================
# Matrix Swarm — Cross-Platform Setup Script
# Engines covered: llama.cpp  |  MLX-LM  |  vLLM  |  Docker Model Runner
# Platforms:       macOS (Apple Silicon + Intel)  |  Ubuntu / Debian / Fedora
#
# Usage:  bash scripts/setup.sh
# Re-run safe: all steps are idempotent.
# =============================================================================
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[1;33m'
BLU='\033[0;34m'; CYN='\033[0;36m'; WHT='\033[1;37m'; RST='\033[0m'

banner() { printf "\n${BLU}══════════════════════════════════════════${RST}\n${WHT}  %s${RST}\n${BLU}══════════════════════════════════════════${RST}\n" "$1"; }
ok()     { printf "  ${GRN}✔${RST}  %s\n" "$1"; }
info()   { printf "  ${CYN}→${RST}  %s\n" "$1"; }
warn()   { printf "  ${YLW}⚠${RST}  %s\n" "$1"; }
fail()   { printf "  ${RED}✘${RST}  %s\n" "$1"; }
ask()    { printf "  ${YLW}?${RST}  %s [y/N]: " "$1"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"
ARCH="$(uname -m)"
ENV_FILE="$ROOT/.env"

# ── Banner ────────────────────────────────────────────────────────────────────
printf "${GRN}"
cat << 'EOF'
  ███╗   ███╗ █████╗ ████████╗██████╗ ██╗██╗  ██╗
  ████╗ ████║██╔══██╗╚══██╔══╝██╔══██╗██║╚██╗██╔╝
  ██╔████╔██║███████║   ██║   ██████╔╝██║ ╚███╔╝
  ██║╚██╔╝██║██╔══██║   ██║   ██╔══██╗██║ ██╔██╗
  ██║ ╚═╝ ██║██║  ██║   ██║   ██║  ██║██║██╔╝ ██╗
  ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
              S W A R M  — setup.sh
EOF
printf "${RST}\n"
printf "  Project root : %s\n" "$ROOT"
printf "  OS / Arch    : %s / %s\n\n" "$OS" "$ARCH"

# =============================================================================
# 1. Platform
# =============================================================================
banner "1 / 13  Platform"

case "$OS" in
    Darwin)
        ok "macOS $(sw_vers -productVersion)"
        [[ "$ARCH" == "arm64" ]] \
            && ok "Apple Silicon — Metal + MLX available" \
            || warn "Intel Mac — Metal/MLX not available; llama CPU-only"
        PKG_INSTALL="brew install"
        PIP_EXTRA=""   # macOS pip works out-of-the-box for most packages
        ;;
    Linux)
        if command -v apt-get &>/dev/null; then
            ok "Ubuntu / Debian Linux"
            PKG_INSTALL="sudo apt-get install -y"
        elif command -v dnf &>/dev/null; then
            ok "Fedora / RHEL Linux"
            PKG_INSTALL="sudo dnf install -y"
        else
            warn "Unknown Linux distro — you may need to install packages manually"
            PKG_INSTALL="echo MISSING:"
        fi
        # Detect CUDA for vLLM
        if command -v nvidia-smi &>/dev/null; then
            CUDA_VER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 || echo "unknown")
            ok "NVIDIA GPU detected (driver $CUDA_VER) — CUDA vLLM available"
            HAS_CUDA=true
        else
            warn "No NVIDIA GPU detected — vLLM will run CPU-only (very slow)"
            HAS_CUDA=false
        fi
        PIP_EXTRA=""
        ;;
    *)
        fail "Unsupported OS: $OS"; exit 1 ;;
esac

TOTAL_RAM_GB=0
if [[ "$OS" == "Darwin" ]]; then
    TOTAL_RAM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
elif [[ -f /proc/meminfo ]]; then
    TOTAL_RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1048576 ))
fi
(( TOTAL_RAM_GB < 8  )) && { fail "Minimum 8 GB RAM required (detected ${TOTAL_RAM_GB} GB)"; exit 1; }
(( TOTAL_RAM_GB < 16 )) && warn "RAM: ${TOTAL_RAM_GB} GB — 16 GB+ recommended" \
                         || ok  "RAM: ${TOTAL_RAM_GB} GB"

FREE_GB=$(( $(df -k / | awk 'NR==2{print $4}') / 1048576 ))
(( FREE_GB < 5  )) && { fail "< 5 GB free disk space"; exit 1; }
(( FREE_GB < 20 )) && warn "Disk: ${FREE_GB} GB free — 20 GB+ recommended for models" \
                    || ok  "Disk: ${FREE_GB} GB free"

# =============================================================================
# 2. System packages
# =============================================================================
banner "2 / 13  System Packages"

need_pkg() {
    local cmd="$1" pkg="${2:-$1}"
    if command -v "$cmd" &>/dev/null; then
        ok "$cmd: $(command -v "$cmd")"
    else
        info "Installing $pkg ..."
        if [[ "$OS" == "Darwin" ]]; then
            command -v brew &>/dev/null || {
                info "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                [[ "$ARCH" == "arm64" ]] \
                    && eval "$(/opt/homebrew/bin/brew shellenv)" \
                    || eval "$(/usr/local/bin/brew shellenv)"
            }
        elif command -v apt-get &>/dev/null; then
            sudo apt-get update -qq
        fi
        $PKG_INSTALL "$pkg"
        ok "$cmd installed"
    fi
}

need_pkg git
need_pkg cmake
need_pkg curl
need_pkg python3
if [[ "$OS" == "Linux" ]]; then
    need_pkg g++ g++
    need_pkg make
    sudo apt-get install -y libssl-dev python3-pip python3-venv 2>/dev/null || true
fi

# C++ compiler
if   command -v c++    &>/dev/null; then CXX_CMD="c++"
elif command -v g++    &>/dev/null; then CXX_CMD="g++"
elif command -v clang++ &>/dev/null; then CXX_CMD="clang++"
else fail "No C++ compiler found — install g++ or clang++"; exit 1
fi
ok "C++ compiler: $CXX_CMD"

# pip
if ! command -v pip3 &>/dev/null && ! python3 -m pip --version &>/dev/null 2>&1; then
    info "Installing pip..."
    curl -sS https://bootstrap.pypa.io/get-pip.py | python3
fi
PIP="python3 -m pip"
ok "pip: $(python3 -m pip --version | cut -d' ' -f1-2)"

# =============================================================================
# 3. Node.js
# =============================================================================
banner "3 / 13  Node.js (≥18)"

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
    (( NODE_MAJOR >= 18 )) && NODE_OK=true
fi

if ! $NODE_OK; then
    if [[ "$OS" == "Darwin" ]]; then
        info "Installing Node.js via Homebrew..."
        brew install node@22
        brew link --overwrite node@22 2>/dev/null || brew link node@22 2>/dev/null || true
    else
        info "Installing Node.js 22 via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
fi
ok "Node.js: $(node --version)"
ok "npm: $(npm --version)"

# =============================================================================
# 4. npm install
# =============================================================================
banner "4 / 13  Node Dependencies"

cd "$ROOT"
npm install --prefer-offline 2>&1 | tail -3
ok "node_modules ready"

# =============================================================================
# 5. Build C++ binaries (coordinator + proxy)
# =============================================================================
banner "5 / 13  Build C++ Binaries"

cd "$ROOT"

rebuild_needed() {
    local bin="$1"; shift
    [[ ! -x "$ROOT/$bin" ]] && return 0
    for src in "$@"; do [[ "$ROOT/$src" -nt "$ROOT/$bin" ]] && return 0; done
    return 1
}

if rebuild_needed coordinator coordinator.cpp; then
    info "Compiling coordinator..."
    $CXX_CMD -std=c++17 -O2 -o coordinator coordinator.cpp -pthread
    ok "coordinator built"
else
    ok "coordinator up-to-date"
fi

if rebuild_needed proxy proxy.cpp proxy_configure.cpp matrix_env.cpp; then
    info "Compiling proxy..."
    $CXX_CMD -std=c++17 -O2 -o proxy proxy.cpp proxy_configure.cpp matrix_env.cpp -pthread
    ok "proxy built"
else
    ok "proxy up-to-date"
fi

chmod +x "$ROOT/coordinator" "$ROOT/proxy"
ok "Binaries executable (chmod +x)"

# =============================================================================
# 6. Script permissions
# =============================================================================
banner "6 / 13  Script Permissions"

SCRIPTS=(
    scripts/launch_matrix.sh   scripts/shutdown_matrix.sh
    scripts/matrix-env.sh      scripts/matrix-validate-env.sh
    scripts/build.sh           scripts/build_coordinator.sh
    scripts/start_vllm_servers.sh
    scripts/start_matrix_airgapped.sh  scripts/start_matrix_text_image.sh
    scripts/swarm_launch.sh    scripts/swarm_status.sh
    scripts/start_swarm.sh     scripts/shutdown_swarm.sh
    scripts/cleanup.sh         scripts/clear_cache.sh
    scripts/up.sh              scripts/down.sh
    scripts/start.sh           scripts/stop.sh
    scripts/install.sh         scripts/setup.sh
)
for s in "${SCRIPTS[@]}"; do
    f="$ROOT/$s"; [[ -f "$f" ]] && chmod +x "$f" && ok "$s" || true
done

# =============================================================================
# 7. Environment file (.env)
# =============================================================================
banner "7 / 13  Environment (.env)"

if [[ -f "$ENV_FILE" ]]; then
    ok ".env exists (not overwritten)"
else
    [[ "$OS" == "Darwin" ]] \
        && MODEL_DIR_DEFAULT="/Users/Shared/llama/models"   LLAMA_BIN_DEFAULT="/Users/Shared/llama/llama-server" \
        || MODEL_DIR_DEFAULT="${HOME}/.local/share/matrix/models" LLAMA_BIN_DEFAULT="${HOME}/.local/bin/llama-server"

    cat > "$ENV_FILE" << ENVEOF
# Matrix Swarm — runtime environment  (generated $(date))
# Edit paths before running launch_matrix.sh

# ── llama.cpp ─────────────────────────────────────────────────────────────────
MATRIX_MODEL_DIR=${MODEL_DIR_DEFAULT}
MATRIX_LLAMA_SERVER=${LLAMA_BIN_DEFAULT}

# ── MLX (Apple Silicon only) ──────────────────────────────────────────────────
# Python in the venv that has mlx-lm installed.
# After setup: MATRIX_MLX_PYTHON=${ROOT}/.venv-mlx/bin/python3
MATRIX_MLX_PYTHON=

# ── vLLM ──────────────────────────────────────────────────────────────────────
# Python in the venv that has vllm installed.
# After setup: MATRIX_VLLM_PYTHON=${ROOT}/.venv-vllm/bin/python3
MATRIX_VLLM_PYTHON=

# ── Runtime ───────────────────────────────────────────────────────────────────
MATRIX_ACTIVE_CONFIG=/tmp/matrix-active-config.json
MATRIX_SLOTS_DIR=/tmp/matrix-slots
MATRIX_PROXY_PORT=3002
MATRIX_COORDINATOR_PORT=8000
ENVEOF
    ok ".env created"
    warn "Review $ENV_FILE and set MATRIX_MODEL_DIR / MATRIX_LLAMA_SERVER"
fi

# Load env for remainder of script (ignore unset vars that are commented out)
while IFS='=' read -r key val; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    key="${key// /}"
    val="${val%%#*}"    # strip inline comments
    val="${val//\"/}"  # strip quotes
    val="${val// /}"
    [[ -n "$key" ]] && export "$key=$val" 2>/dev/null || true
done < "$ENV_FILE"

# =============================================================================
# 8. Model directory & llama-server
# =============================================================================
banner "8 / 13  llama.cpp / llama-server"

MODEL_DIR="${MATRIX_MODEL_DIR:-}"
LLAMA_BIN="${MATRIX_LLAMA_SERVER:-}"

if [[ -n "$MODEL_DIR" ]]; then
    if [[ "$OS" == "Darwin" ]] && [[ "$MODEL_DIR" == /Users/Shared/* ]]; then
        if [[ ! -d "$MODEL_DIR" ]]; then
            info "Creating /Users/Shared model dir (requires sudo)..."
            sudo mkdir -p "$MODEL_DIR"
        fi
        sudo chown -R "$(whoami):staff" "$(dirname "$MODEL_DIR")" 2>/dev/null || true
        chmod -R 755 "$(dirname "$MODEL_DIR")" 2>/dev/null || true
    else
        mkdir -p "$MODEL_DIR"
        chmod 755 "$MODEL_DIR"
    fi
    ok "Model dir: $MODEL_DIR"
    GGUF_COUNT=$(find "$MODEL_DIR" -maxdepth 2 -name "*.gguf" 2>/dev/null | wc -l | tr -d ' ')
    (( GGUF_COUNT > 0 )) && ok "${GGUF_COUNT} GGUF model(s) present" \
                          || warn "No GGUF models found — add models before launching"
else
    warn "MATRIX_MODEL_DIR not set"
fi

if [[ -n "$LLAMA_BIN" ]] && [[ -x "$LLAMA_BIN" ]]; then
    ok "llama-server: $LLAMA_BIN"
else
    warn "llama-server not found at: ${LLAMA_BIN:-<not set in .env>}"
    echo
    ask "Build llama-server from source now? (~5-10 min, requires cmake)"
    read -r BUILD_LLAMA; echo

    if [[ "${BUILD_LLAMA,,}" == "y" ]]; then
        if [[ "$OS" == "Darwin" ]]; then
            LLAMA_SRC="$(dirname "${LLAMA_BIN:-/Users/Shared/llama/llama-server}")/llama.cpp"
            INSTALL_DIR="$(dirname "${LLAMA_BIN:-/Users/Shared/llama/llama-server}")"
            sudo mkdir -p "$INSTALL_DIR" 2>/dev/null || mkdir -p "$INSTALL_DIR"
        else
            LLAMA_SRC="${HOME}/.local/src/llama.cpp"
            INSTALL_DIR="${HOME}/.local/bin"
            mkdir -p "$INSTALL_DIR"
        fi

        if [[ -d "$LLAMA_SRC/.git" ]]; then
            info "Updating llama.cpp clone..."
            git -C "$LLAMA_SRC" pull --ff-only 2>/dev/null || true
        else
            info "Cloning llama.cpp..."
            git clone --depth=1 https://github.com/ggerganov/llama.cpp "$LLAMA_SRC"
        fi

        NCORES="$(nproc 2>/dev/null || sysctl -n hw.logicalcpu 2>/dev/null || echo 4)"
        mkdir -p "$LLAMA_SRC/build"
        info "cmake configure..."
        if [[ "$OS" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
            cmake -S "$LLAMA_SRC" -B "$LLAMA_SRC/build" \
                -DLLAMA_METAL=on -DLLAMA_NATIVE=on -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF
        else
            cmake -S "$LLAMA_SRC" -B "$LLAMA_SRC/build" \
                -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF
        fi
        info "Building with $NCORES cores..."
        cmake --build "$LLAMA_SRC/build" --config Release -j "$NCORES" --target llama-server

        SRC_BIN="$LLAMA_SRC/build/bin/llama-server"
        [[ -f "$SRC_BIN" ]] || SRC_BIN="$LLAMA_SRC/build/llama-server"
        cp "$SRC_BIN" "$INSTALL_DIR/llama-server"
        chmod +x "$INSTALL_DIR/llama-server"

        ACTUAL_BIN="$INSTALL_DIR/llama-server"
        sed -i.bak "s|MATRIX_LLAMA_SERVER=.*|MATRIX_LLAMA_SERVER=${ACTUAL_BIN}|" "$ENV_FILE" \
            && rm -f "$ENV_FILE.bak"
        ok "llama-server installed: $ACTUAL_BIN"
    else
        info "Skipped — set MATRIX_LLAMA_SERVER in .env once installed"
    fi
fi

# =============================================================================
# Helper: locate conda/mamba executable
# =============================================================================
find_conda() {
    # Precedence: mamba > conda, search common install roots
    local candidates=(
        "$(command -v mamba 2>/dev/null)"
        "$(command -v conda 2>/dev/null)"
        "$HOME/miniforge3/bin/conda"
        "$HOME/mambaforge/bin/conda"
        "$HOME/miniconda3/bin/conda"
        "$HOME/anaconda3/bin/conda"
        "/opt/homebrew/Caskroom/miniforge/base/bin/conda"
        "/usr/local/bin/conda"
        "/opt/conda/bin/conda"
    )
    for c in "${candidates[@]}"; do
        [[ -x "$c" ]] && { echo "$c"; return 0; }
    done
    return 1
}

install_conda() {
    info "Installing Miniforge3 (conda + mamba)..."
    local url installer
    if [[ "$OS" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
        url="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-arm64.sh"
    elif [[ "$OS" == "Darwin" ]]; then
        url="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-MacOSX-x86_64.sh"
    elif [[ "$ARCH" == "aarch64" ]]; then
        url="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-aarch64.sh"
    else
        url="https://github.com/conda-forge/miniforge/releases/latest/download/Miniforge3-Linux-x86_64.sh"
    fi
    installer="/tmp/miniforge3_install.sh"
    curl -fsSL -o "$installer" "$url"
    bash "$installer" -b -p "$HOME/miniforge3"
    rm -f "$installer"
    export PATH="$HOME/miniforge3/bin:$PATH"
    ok "Miniforge3 installed: $HOME/miniforge3"
}

# Resolve CONDA_CMD once; used by steps 9 and 10
CONDA_CMD=""
if CONDA_CMD=$(find_conda); then
    ok "conda found: $CONDA_CMD ($(${CONDA_CMD} --version 2>&1 | head -1))"
fi

# =============================================================================
# 9. MLX-LM  (Apple Silicon only)
# =============================================================================
banner "9 / 13  MLX-LM (Apple Silicon + conda)"

if [[ "$OS" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
    MLX_ENV="matrix-mlx"

    # Check if already set up — accept matrix-mlx, mlx-env, or mlx as env name
    MLX_PYTHON=""
    for _try_env in matrix-mlx mlx-env mlx; do
        for _try_root in "$HOME/miniforge3" "$HOME/mambaforge" "$HOME/miniconda3" \
                         "$HOME/anaconda3" "/opt/homebrew/Caskroom/miniforge/base" "/opt/conda"; do
            _try_py="$_try_root/envs/$_try_env/bin/python3"
            if [[ -x "$_try_py" ]] && "$_try_py" -c "import mlx_lm" 2>/dev/null; then
                MLX_PYTHON="$_try_py"
                ok "mlx-lm already installed in conda env '$_try_env': $MLX_PYTHON"
                break 2
            fi
        done
    done

    if [[ -z "$MLX_PYTHON" ]]; then
        ask "Install mlx-lm via conda? (Metal-native inference, ~300 MB)"
        read -r INSTALL_MLX; echo

        if [[ "${INSTALL_MLX,,}" == "y" ]]; then
            # Ensure conda is available
            if [[ -z "$CONDA_CMD" ]]; then
                ask "conda not found — install Miniforge3 now?"
                read -r INST_CONDA; echo
                [[ "${INST_CONDA,,}" == "y" ]] && install_conda \
                    || { warn "Skipped — install Miniforge3 manually then re-run"; INSTALL_MLX="n"; }
                CONDA_CMD=$(find_conda 2>/dev/null) || true
            fi

            if [[ -n "$CONDA_CMD" ]]; then
                info "Creating conda env '$MLX_ENV' (python=3.11)..."
                "$CONDA_CMD" create -n "$MLX_ENV" python=3.11 -y --quiet
                _mlx_prefix=$("$CONDA_CMD" env list 2>/dev/null | awk -v env="$MLX_ENV" '$1==env{print $NF}')
                info "Installing mlx-lm..."
                "$_mlx_prefix/bin/pip" install --upgrade pip --quiet
                "$_mlx_prefix/bin/pip" install mlx-lm --quiet
                MLX_PYTHON="$_mlx_prefix/bin/python3"
                ok "mlx-lm $("$MLX_PYTHON" -c 'import mlx_lm; print(mlx_lm.__version__)' 2>/dev/null || echo ok): $MLX_PYTHON"
            fi
        else
            info "Skipped — later: conda create -n matrix-mlx python=3.11 && conda run -n matrix-mlx pip install mlx-lm"
        fi
    fi

    if [[ -n "$MLX_PYTHON" ]]; then
        if grep -q "^MATRIX_MLX_PYTHON=" "$ENV_FILE"; then
            sed -i.bak "s|^MATRIX_MLX_PYTHON=.*|MATRIX_MLX_PYTHON=${MLX_PYTHON}|" "$ENV_FILE" \
                && rm -f "$ENV_FILE.bak"
        else
            echo "MATRIX_MLX_PYTHON=${MLX_PYTHON}" >> "$ENV_FILE"
        fi
        ok "MATRIX_MLX_PYTHON set in .env"
    fi
else
    info "MLX-LM skipped — requires Apple Silicon (arm64 macOS)"
fi

# =============================================================================
# 10. vLLM (conda env)
# =============================================================================
banner "10 / 13  vLLM (conda)"

VLLM_ENV="matrix-vllm"
VLLM_PYTHON=""

if [[ -n "$CONDA_CMD" ]]; then
    _vllm_prefix=$("$CONDA_CMD" env list 2>/dev/null | awk -v env="$VLLM_ENV" '$1==env{print $NF}')
    if [[ -n "$_vllm_prefix" ]] && [[ -x "$_vllm_prefix/bin/python3" ]]; then
        if "$_vllm_prefix/bin/python3" -c "import vllm" 2>/dev/null; then
            VLLM_PYTHON="$_vllm_prefix/bin/python3"
            ok "vLLM already installed in conda env '$VLLM_ENV': $VLLM_PYTHON"
        fi
    fi
fi

if [[ -z "$VLLM_PYTHON" ]]; then
    echo
    if [[ "$OS" == "Darwin" ]]; then
        printf "  ${CYN}Note:${RST} vLLM on macOS has limited CUDA support.\n"
        printf "  Most useful when targeting a remote Linux/CUDA host.\n"
    else
        ${HAS_CUDA:-false} \
            && printf "  ${GRN}NVIDIA GPU detected${RST} — full CUDA vLLM available.\n" \
            || printf "  ${YLW}No CUDA GPU${RST} — vLLM will run CPU-only (slow for large models).\n"
    fi
    echo

    ask "Install vLLM via conda?"
    read -r INSTALL_VLLM; echo

    if [[ "${INSTALL_VLLM,,}" == "y" ]]; then
        if [[ -z "$CONDA_CMD" ]]; then
            ask "conda not found — install Miniforge3 now?"
            read -r INST_CONDA2; echo
            [[ "${INST_CONDA2,,}" == "y" ]] && install_conda \
                || { warn "Skipped — install Miniforge3 then re-run"; INSTALL_VLLM="n"; }
            CONDA_CMD=$(find_conda 2>/dev/null) || true
        fi

        if [[ -n "$CONDA_CMD" ]]; then
            info "Creating conda env '$VLLM_ENV' (python=3.11)..."
            "$CONDA_CMD" create -n "$VLLM_ENV" python=3.11 -y --quiet
            _vllm_prefix=$("$CONDA_CMD" env list 2>/dev/null | awk -v env="$VLLM_ENV" '$1==env{print $NF}')
            info "Installing vLLM..."
            "$_vllm_prefix/bin/pip" install --upgrade pip --quiet

            if [[ "$OS" == "Linux" ]] && ${HAS_CUDA:-false}; then
                "$_vllm_prefix/bin/pip" install vllm --quiet
            else
                # CPU-compatible build
                "$_vllm_prefix/bin/pip" install vllm --quiet 2>/dev/null \
                    || "$_vllm_prefix/bin/pip" install vllm \
                        --extra-index-url https://download.pytorch.org/whl/cpu --quiet
            fi

            VLLM_PYTHON="$_vllm_prefix/bin/python3"
            VLLM_VER=$("$VLLM_PYTHON" -c "import vllm; print(vllm.__version__)" 2>/dev/null || echo "installed")
            ok "vLLM $VLLM_VER: $VLLM_PYTHON"
        fi
    else
        info "Skipped — later: conda create -n matrix-vllm python=3.11 && conda run -n matrix-vllm pip install vllm"
    fi
fi

if [[ -n "$VLLM_PYTHON" ]]; then
    if grep -q "^MATRIX_VLLM_PYTHON=" "$ENV_FILE"; then
        sed -i.bak "s|^MATRIX_VLLM_PYTHON=.*|MATRIX_VLLM_PYTHON=${VLLM_PYTHON}|" "$ENV_FILE" \
            && rm -f "$ENV_FILE.bak"
    else
        echo "MATRIX_VLLM_PYTHON=${VLLM_PYTHON}" >> "$ENV_FILE"
    fi
    ok "MATRIX_VLLM_PYTHON set in .env"
fi

# =============================================================================
# 11. Docker  (Engine + Model Runner plugin)
# =============================================================================
banner "11 / 13  Docker + Model Runner"

DOCKER_OK=false
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
    ok "Docker running: $DOCKER_VER"
    DOCKER_OK=true
fi

if ! $DOCKER_OK; then
    echo
    if [[ "$OS" == "Darwin" ]]; then
        printf "  Docker Desktop for Mac is required for the docker / docker-vllm backends.\n"
        printf "  Download: https://www.docker.com/products/docker-desktop\n\n"
        ask "Open Docker Desktop download page in browser?"
        read -r OPEN_DOCKER; echo
        [[ "${OPEN_DOCKER,,}" == "y" ]] && open "https://www.docker.com/products/docker-desktop" || true
        warn "Install Docker Desktop manually, then re-run this script to verify."
    else
        ask "Install Docker Engine (docker.io) now?"
        read -r INSTALL_DOCKER; echo
        if [[ "${INSTALL_DOCKER,,}" == "y" ]]; then
            info "Installing Docker Engine via official script..."
            curl -fsSL https://get.docker.com | sudo sh
            sudo usermod -aG docker "$(whoami)"
            info "Starting Docker service..."
            sudo systemctl enable --now docker
            ok "Docker Engine installed"
            warn "Log out and back in (or run: newgrp docker) for group membership to take effect"
            DOCKER_OK=true
        else
            info "Skipped — install Docker manually: https://docs.docker.com/engine/install"
        fi
    fi
fi

# Docker Model Runner plugin check (docker model subcommand)
if $DOCKER_OK; then
    if docker model --help &>/dev/null 2>&1; then
        ok "Docker Model Runner plugin available (docker model ...)"
    else
        echo
        warn "Docker Model Runner plugin not found (needed for backend: docker / docker-vllm)"
        printf "\n  To install on macOS:\n"
        printf "    Docker Desktop → Settings → Features in Development → Enable 'Docker Model Runner'\n\n"
        printf "  To install on Linux:\n"
        printf "    docker plugin install docker/model-runner --grant-all-permissions\n\n"
        printf "  Or pull models with Docker Desktop's AI Catalog.\n"
    fi
fi

# =============================================================================
# 12. Model directory & llama-server (already done in step 8 — confirm)
# =============================================================================
# (Covered above; step number kept for display consistency)

# =============================================================================
# 12. React build
# =============================================================================
banner "12 / 13  React Build"

ask "Build React production bundle? (skip to use 'npm start' dev server)"
read -r BUILD_REACT; echo

if [[ "${BUILD_REACT,,}" == "y" ]]; then
    info "Running npm run build..."
    cd "$ROOT"
    npm run build 2>&1 | tail -6
    chmod -R 755 "$ROOT/build"
    ok "React build/ ready"
else
    info "Skipped — use 'npm start' for dev, or 'npm run build' later for production"
fi

# =============================================================================
# 13. Runtime directories
# =============================================================================
banner "13 / 13  Runtime Directories"

mkdir -p "$ROOT/logs" "$ROOT/agent_logs"
chmod 755 "$ROOT/logs" "$ROOT/agent_logs"
mkdir -p /tmp/matrix-slots 2>/dev/null || true
ok "logs/  agent_logs/  /tmp/matrix-slots/"

# =============================================================================
# Summary
# =============================================================================
banner "Setup Summary"

chk() {
    local label="$1" path="$2" flag="${3:--e}"
    test "$flag" "$path" && ok "$label" || fail "$label — missing: $path"
}

chk "coordinator"              "$ROOT/coordinator"              -x
chk "proxy"                    "$ROOT/proxy"                    -x
chk "node_modules"             "$ROOT/node_modules"             -d
chk "swarm-config.json"        "$ROOT/swarm-config.json"        -f
chk "public/swarm-config.json" "$ROOT/public/swarm-config.json" -f
chk ".env"                     "$ROOT/.env"                     -f
chk "logs/"                    "$ROOT/logs"                     -d
chk "agent_logs/"              "$ROOT/agent_logs"               -d

# Engines
echo
printf "  ${WHT}Engines:${RST}\n"
_LLAMA="${MATRIX_LLAMA_SERVER:-}"
[[ -n "$_LLAMA" ]] && [[ -x "$_LLAMA" ]] \
    && ok "llama.cpp  : $_LLAMA" \
    || warn "llama.cpp  : not installed — set MATRIX_LLAMA_SERVER in .env"

_MLX="${MATRIX_MLX_PYTHON:-}"
if [[ "$OS" == "Darwin" ]] && [[ "$ARCH" == "arm64" ]]; then
    [[ -n "$_MLX" ]] && [[ -x "$_MLX" ]] && "$_MLX" -c "import mlx_lm" 2>/dev/null \
        && ok "MLX-LM     : $_MLX" \
        || warn "MLX-LM     : not installed (optional) — run: .venv-mlx/bin/pip install mlx-lm"
else
    info "MLX-LM     : N/A (Apple Silicon only)"
fi

_VLLM="${MATRIX_VLLM_PYTHON:-}"
[[ -n "$_VLLM" ]] && [[ -x "$_VLLM" ]] && "$_VLLM" -c "import vllm" 2>/dev/null \
    && ok "vLLM       : $_VLLM" \
    || warn "vLLM       : not installed (optional) — run: .venv-vllm/bin/pip install vllm"

command -v docker &>/dev/null && docker info &>/dev/null 2>&1 \
    && { docker model --help &>/dev/null 2>&1 \
         && ok "Docker     : running + Model Runner plugin present" \
         || warn "Docker     : running but Model Runner plugin missing (see step 11)"; } \
    || warn "Docker     : not running (optional — needed for docker/docker-vllm backends)"

[[ -d "$ROOT/build" ]] && ok "React build : $ROOT/build/" \
                        || info "React build : not built (run 'npm run build' or use 'npm start')"

echo
printf "${GRN}  ✔  Setup complete!${RST}\n\n"
printf "${WHT}  Quick reference:${RST}\n\n"
printf "  %-34s %s\n" "Bring up:"             "bash scripts/launch_matrix.sh"
printf "  %-34s %s\n" "Bring down:"            "bash scripts/shutdown_matrix.sh"
printf "  %-34s %s\n" "Dev UI:"                "npm start  →  http://localhost:3000"
printf "  %-34s %s\n" "Rebuild C++ binaries:"  "bash scripts/build.sh"
printf "  %-34s %s\n" "Start docker-vllm:"     "bash scripts/start_vllm_servers.sh --wait"
printf "\n  ${CYN}In the UI: CONFIGURE → select engine + agents → LAUNCH SWARM → prompt${RST}\n\n"

printf "  ${WHT}Engine selection in swarm-config.json:${RST}\n"
printf "  %-14s %s\n" "backend:llama"      "GGUF via llama-server  (MATRIX_LLAMA_SERVER)"
printf "  %-14s %s\n" "backend:mlx"        "MLX via mlx_lm.server  (MATRIX_MLX_PYTHON)"
printf "  %-14s %s\n" "backend:vllm"       "vLLM server            (MATRIX_VLLM_PYTHON)"
printf "  %-14s %s\n" "backend:docker"     "Docker Model Runner    (docker model run)"
printf "  %-14s %s\n" "backend:docker-vllm" "Docker + vLLM backend  (docker model run --backend vllm)"
echo
