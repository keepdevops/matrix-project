#!/bin/bash

# Destination directory
DEST_DIR="/Users/Shared/llama/models/models/"
mkdir -p "$DEST_DIR"

# Function to download with curl (resume support)
download_model() {
    local url="$1"
    local filename="$2"
    echo "Downloading $filename from $url..."
    curl -L -C - -o "$DEST_DIR/$filename" "$url"
    if [ $? -eq 0 ]; then
        echo "Downloaded $filename successfully."
    else
        echo "Error downloading $filename."
    fi
}

# Section 1: Meta Llama (3.1 and 3.2) - Safetensors (requires approval)
# Instructions: 1. Request access at https://llama.meta.com/llama-downloads
# 2. Clone Meta's repo: git clone https://github.com/meta-llama/llama-models
# 3. Run their download.sh: ./download.sh --model llama-3.1-8b-instruct (generates presigned URLs)
# 4. Use those URLs below (replace placeholders). For GGUF, convert safetensors with llama.cpp.
# Example presigned (temporary; regenerate via script)
# download_model "https://presigned-url-from-meta.com/Meta-Llama-3.1-8B-Instruct/model-00001-of-00004.safetensors" "Meta-Llama-3.1-8B-Instruct-00001.safetensors"
# For 3.2 (similar):
# download_model "https://presigned-url-from-meta.com/Meta-Llama-3.2-3B-Instruct/model.safetensors" "Meta-Llama-3.2-3B-Instruct.safetensors"

# HF fallback (after approval, for safetensors; not GGUF direct from Meta)
download_model "https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct/resolve/main/model-00001-of-00004.safetensors" "Meta-Llama-3.1-8B-Instruct-00001.safetensors"
# Add more shards if multi-file

# Section 2: IBM Granite 3.1 - Safetensors (official on HF)
download_model "https://huggingface.co/ibm-granite/granite-3.1-8b-instruct/resolve/main/model-00001-of-00004.safetensors" "granite-3.1-8b-instruct-00001.safetensors"
# For GGUF (community, but closest to direct): Use bartowski as before, or convert safetensors

# Section 3: Google Gemma 2 - Official GGUF (direct from Google on HF)
download_model "https://huggingface.co/google/gemma-2-2b-GGUF/resolve/main/gemma-2-2b.gguf" "gemma-2-2b.gguf"  # f32 GGUF
# For instruct variant:
download_model "https://huggingface.co/google/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.gguf" "gemma-2-2b-it.gguf"
# Safetensors alternative (for MLX conversion):
download_model "https://huggingface.co/google/gemma-2-2b/resolve/main/model.safetensors" "gemma-2-2b.safetensors"

# Bonus: Other compatible models (e.g., from Mistral or Alibaba Qwen for variety)
# Mistral (official safetensors):
# download_model "https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.3/resolve/main/model-00001-of-00003.safetensors" "Mistral-7B-Instruct-v0.3-00001.safetensors"
# Qwen (Alibaba, GGUF community):
# download_model "https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/qwen2-1_5b-instruct-q4_k_m.gguf" "qwen2-1.5b-instruct-q4_k_m.gguf"

echo "All selected downloads complete. Models are in $DEST_DIR."
echo "Next steps: For MLX, convert safetensors if needed. For llama.cpp, use GGUF directly."
