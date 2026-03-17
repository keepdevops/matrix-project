#!/bin/bash

echo "Checking dependencies..."

# Check for Pixi (since you're using it for Python/C++ env)
if ! command -v pixi &> /dev/null; then
    echo "Pixi not found. Installing Pixi..."
    curl -fsSL https://pixi.sh/install.sh | bash
    source ~/.bashrc # or ~/.zshrc
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is required. Please install it or use 'pixi add nodejs'."
    exit 1
fi

# Build the C++ coordinator locally (safest for cross-platform)
echo "Building C++ coordinator..."
pixi run g++ -O3 coordinator.cpp -o coordinator

echo "Installation successful. Run './coordinator' to begin."
