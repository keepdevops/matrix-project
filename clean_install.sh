#!/bin/bash
set -e # Exit immediately if a command fails
# Check if we are already 'root' (the super-user)
if [ "$EUID" -ne 0 ]; then
  echo "I need Admin powers to install your tools."
  echo "Please type your Mac password when asked:"
  # This line restarts the script itself with 'sudo'
  exec sudo "$0" "$@"
fi
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "-----------------------------------------------"
echo "   Matrix Project: Universal Installer"
echo "-----------------------------------------------"
echo "sudo chown -R $(whoami) /opt/homebrew /opt/homebrew/share/aclocal /opt/homebrew/share/info /opt/homebrew/share/man/man3 /opt/homebrew/share/zsh /opt/homebrew/share/zsh/site-functions"
echo " "
echo "chmod u+w /opt/homebrew /opt/homebrew/share/aclocal /opt/homebrew/share/info /opt/homebrew/share/man/man3 /opt/homebrew/share/zsh /opt/homebrew/share/zsh/site-functions"
echo ""

echo " 1. System Check & Dependencies (macOS)"
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

echo"2. Setup C++ (llama.cpp)"
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

echo"3. Setup Node.js / npm"
if [ -f "package.json" ]; then
    echo "--> Installing npm dependencies..."
    npm install
fi

echo" 4. Setup Python (if using requirements.txt)"
if [ -f "requirements.txt" ]; then
    echo "--> Setting up Python environment..."
    python3 -m venv venv
    source venv/bin/bin/activate
    pip install -r requirements.txt
fi

echo "-----------------------------------------------"
echo "   Installation Complete!"
echo "-----------------------------------------------"
