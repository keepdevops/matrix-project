#!/bin/bash
# Convert or download models for use with either llama (GGUF) or mlx-lm on M3/Apple Silicon.
# Usage:
#   ./scripts/convert_models.sh download <url> [output_filename]   # curl, no gated access
#   ./scripts/convert_models.sh bartowski <repo> <filename>        # curl from bartowski GGUF repos
#   ./scripts/convert_models.sh mlx <hf_repo> [output_name]
#   ./scripts/convert_models.sh gguf <hf_repo> [output_name]   # requires LLAMA_CPP_DIR
#
# Examples:
#   ./scripts/convert_models.sh download https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
#   ./scripts/convert_models.sh bartowski Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q4_K_M.gguf
#   ./scripts/convert_models.sh bartowski Mistral-7B-Instruct-v0.3-GGUF Mistral-7B-Instruct-v0.3-Q4_K_M.gguf
#   ./scripts/convert_models.sh mlx HuggingFaceTB/SmolLM2-360M-Instruct
#   ./scripts/convert_models.sh gguf meta-llama/Meta-Llama-3.2-3B-Instruct  # gated; needs HF_TOKEN

set -e

MODEL_DIR="${MATRIX_MODELS_DIR:-/Users/Shared/llama/models}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
HF_BASE="https://huggingface.co"

usage() {
    echo "Usage: $0 download <url> [output_filename]"
    echo "       $0 bartowski <repo> <filename>     # e.g. Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q4_K_M.gguf"
    echo "       $0 mlx <hf_repo> [output_name]"
    echo "       $0 gguf <hf_repo> [output_name]"
    echo ""
    echo "  download  - Download via curl (any public GGUF/MLX URL). Output: MODEL_DIR/<output_filename>"
    echo "  bartowski - Download a GGUF file from bartowski's HF repos via curl (no auth). Repo can be 'RepoName' or 'bartowski/RepoName'."
    echo "  mlx       - Convert HF model to MLX 4-bit (for mlx_lm.server on M3). Output: MODEL_DIR/<output_name>/"
    echo "  gguf      - Convert HF model to GGUF (for llama-server). Requires LLAMA_CPP_DIR."
    echo ""
    echo "  MODEL_DIR=${MODEL_DIR}"
    exit 1
}

[ $# -lt 1 ] && usage
MODE="$1"
shift
[ $# -lt 1 ] && usage

mkdir -p "$MODEL_DIR"

# --- Download: curl direct URL (no gated / no HF auth)
if [ "$MODE" = "download" ]; then
    URL="$1"
    OUT_FILE="${2:-}"
    if [ -z "$OUT_FILE" ]; then
        OUT_FILE="$(basename "$URL" | sed 's/?.*//')"
    fi
    DEST="$MODEL_DIR/$OUT_FILE"
    echo "[download] Fetching $URL → $DEST (resume with -C -)"
    curl -L -C - -o "$DEST" "$URL"
    echo "[download] Done. Use in Matrix CONFIGURE; path: $DEST"
    exit 0
fi

# --- Bartowski: curl from bartowski/<repo>/resolve/main/<filename>
if [ "$MODE" = "bartowski" ]; then
    [ $# -lt 2 ] && { echo "Usage: $0 bartowski <repo> <filename>" >&2; usage; }
    REPO="$1"
    FILENAME="$2"
    if [[ "$REPO" != */* ]]; then
        REPO="bartowski/$REPO"
    fi
    URL="$HF_BASE/${REPO}/resolve/main/${FILENAME}"
    DEST="$MODEL_DIR/$FILENAME"
    echo "[bartowski] $REPO → $FILENAME"
    echo "[bartowski] $URL → $DEST (resume with -C -)"
    curl -L -C - -o "$DEST" "$URL"
    echo "[bartowski] Done. Use in Matrix CONFIGURE with LLAMA; path: $DEST"
    exit 0
fi

# --- MLX / GGUF need two more args: hf_repo and optional output_name
HF_REPO="$1"
OUTPUT_NAME="${2:-}"
if [ -z "$OUTPUT_NAME" ]; then
    OUTPUT_NAME="$(basename "$HF_REPO")"
fi

# --- MLX: HuggingFace → MLX 4-bit (for mlx_lm.server on Apple Silicon)
if [ "$MODE" = "mlx" ]; then
    if ! python3 -c "import mlx_lm" 2>/dev/null; then
        echo "Error: mlx-lm not installed. Run: pip install mlx-lm" >&2
        exit 1
    fi
    OUT_DIR="$MODEL_DIR/$OUTPUT_NAME"
    echo "[MLX] Converting $HF_REPO → MLX 4-bit in $OUT_DIR"
    python3 -m mlx_lm convert \
        --hf-path "$HF_REPO" \
        -q --q-bits 4 \
        --mlx-path "$OUT_DIR"
    echo "[MLX] Done. Use in Matrix CONFIGURE with engine MLX; path: $OUT_DIR"
    exit 0
fi

# --- GGUF: HuggingFace → GGUF (for llama-server, incl. M3 Metal)
if [ "$MODE" = "gguf" ]; then
    LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-/Users/Shared/llama/llama.cpp}"
    CONVERT_PY="$LLAMA_CPP_DIR/convert_hf_to_gguf.py"
    if [ ! -f "$CONVERT_PY" ]; then
        # try alternate name
        CONVERT_PY="$LLAMA_CPP_DIR/convert-hf-to-gguf.py"
    fi
    if [ ! -f "$CONVERT_PY" ]; then
        echo "Error: llama.cpp convert script not found. Set LLAMA_CPP_DIR to your llama.cpp clone (containing convert_hf_to_gguf.py)." >&2
        echo "  Example: export LLAMA_CPP_DIR=/Users/Shared/llama/llama.cpp" >&2
        exit 1
    fi
    # Convert to GGUF (--remote for HF repo; often produces fp16; quantize afterward for M3)
    OUT_GGUF="$MODEL_DIR/${OUTPUT_NAME}.gguf"
    echo "[GGUF] Converting $HF_REPO → GGUF (this may download the model and take several minutes)"
    (cd "$LLAMA_CPP_DIR" && python3 "$CONVERT_PY" "$HF_REPO" --remote --outfile "$OUT_GGUF" --outtype f16)
    echo "[GGUF] Done. For smaller/faster inference on M3, quantize with: $LLAMA_CPP_DIR/llama-quantize $OUT_GGUF $MODEL_DIR/${OUTPUT_NAME}-Q4_K_M.gguf Q4_K_M"
    echo "Use in Matrix CONFIGURE with engine LLAMA; path: $OUT_GGUF"
    exit 0
fi

usage
