# MS-145: macOS Apple Silicon (Metal) build environment for the C++ coordinator.
# Metal/GPU access requires a bare-metal host — this container provides a
# reproducible build + test environment only. Run inference on the host;
# use 'brewctl launch' to start the coordinator there.
#
# Build:  docker build -f docker/Dockerfile.metal -t matrix-metal-build .
# Usage:  docker run --rm -v $(pwd):/workspace matrix-metal-build bash scripts/build_cpp_binaries.sh

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    curl \
    python3 \
    python3-pip \
    python3-venv \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Install Python test dependencies (no mlx — Metal is host-only)
COPY requirements*.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt 2>/dev/null || true

CMD ["bash"]
