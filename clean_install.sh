#!/bin/bash
set -e # Exit immediately if a command fails

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "-----------------------------------------------"
echo "   Matrix Project: Universal Installer"
echo "-----------------------------------------------"

# 1. System Check & Dependencies (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "--> Checking macOS dependencies..."
    if ! command -v brew &> /dev/null; then
        echo "Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    # Install CMake (for C++), Node (for npm), and OpenSSL
    brew install cmake node openssl@3
    export OPENSSL_ROOT_DIR=$(brew --prefix openssl@3)
fi

# 2. Setup C++ (llama.cpp)
if [ ! -d "llama.cpp" ]; then
    echo "--> Cloning llama.cpp (shallow clone)..."
    git clone --depth 1 https://github.com/ggml-org/llama.cpp.git
fi

echo "--> Building C++ components..."
mkdir -p llama.cpp/build
cd llama.cpp/build
cmake .. -DOPENSSL_ROOT_DIR=$OPENSSL_ROOT_DIR
cmake --build . --config Release -j $(sysctl -n hw.ncpu || echo 2)
cd "$PROJECT_ROOT"

# 3. Setup Node.js / npm
if [ -f "package.json" ]; then
    echo "--> Installing npm dependencies..."
    npm install
fi

# 4. Setup Python (if using requirements.txt)
if [ -f "requirements.txt" ]; then
    echo "--> Setting up Python environment..."
    python3 -m venv venv
    source venv/bin/bin/activate
    pip install -r requirements.txt
fi

echo "-----------------------------------------------"
echo "   Installation Complete!"
echo "-----------------------------------------------"
