
FROM python:3.12-slim-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
        mlx-lm \
        vllm \
        "vllm-metal>=0.2.0" \
        huggingface_hub[cli] \
        fastapi uvicorn

FROM python:3.12-slim-bookworm

COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

WORKDIR /app

RUN useradd -m -u 1000 vllm && chown -R vllm:vllm /app
USER vllm

VOLUME ["/root/.cache/huggingface", "/models"]

EXPOSE 8000

ENV MODEL="mlx-community/Qwen2.5-7B-Instruct-4bit" \
    PORT=8000 \
    GPU_MEMORY_UTILIZATION=0.72 \
    MAX_MODEL_LEN=8192 \
    MAX_NUM_SEQS=48 \
    ENFORCE_EAGER=1 \
    HF_TOKEN=""

HEALTHCHECK --interval=30s --timeout=15s --start-period=180s --retries=15 \
    CMD curl -f http://localhost:${PORT}/v1/models || exit 1

CMD ["sh", "-c", "\
    if [ -n \"$HF_TOKEN\" ]; then \
        huggingface-cli login --token \"$HF_TOKEN\" --add-to-git-credential || true; \
    fi && \
    vllm serve \"$MODEL\" \
        --port \"$PORT\" \
        --gpu-memory-utilization \"$GPU_MEMORY_UTILIZATION\" \
        --max-model-len \"$MAX_MODEL_LEN\" \
        --max-num-seqs \"$MAX_NUM_SEQS\" \
        --enforce-eager \"$ENFORCE_EAGER\" \
        --host 0.0.0.0 \
        --served-model-name \"$(basename $MODEL)\" \
        ${EXTRA_ARGS:-}"]
