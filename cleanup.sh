#!/bin/bash

# If llama.cpp isn't there, download it for the user
if [ ! -d "llama.cpp" ]; then
    echo "Downloading dependencies..."
    git clone --depth 1 https://github.com/ggerganov/llama.cpp.git
fi

# Now compile it on their specific machine (Apple Silicon or Intel)
cd llama.cpp && make -j
