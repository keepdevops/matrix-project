# Model and llama.cpp Setup Guide

This document describes the new centralized location for models and llama.cpp in the Matrix project.

## New Directory Structure

All models and the llama.cpp library are now stored in a shared location:

```
/Users/Shared/models/
├── llama.cpp/                    # llama.cpp repository and builds
│   ├── build/
│   │   └── bin/
│   │       ├── llama-server      # Server binary
│   │       ├── llama-cli         # CLI binary
│   │       └── ...
│   └── models/                   # llama.cpp vocab files
├── Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf  # Your model files
├── Llama-3.2-3B-Instruct-Q4_K_M.gguf
├── granite-3.1-8b-instruct-Q4_K_M.gguf
├── gemma-2-2b-it-Q4_K_M.gguf
├── llama-server                  # Standalone llama-server binary
└── ...                           # Other model files
```

## Initial Setup

### 1. Create the Shared Directory

```bash
sudo mkdir -p /Users/Shared/models
sudo chown $(whoami):staff /Users/Shared/models
chmod 755 /Users/Shared/models
```

### 2. Move or Clone llama.cpp

If you already have llama.cpp built in this project:

```bash
# Move existing llama.cpp to shared location
mv llama.cpp /Users/Shared/models/
```

If you need to clone llama.cpp fresh:

```bash
cd /Users/Shared/models
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
mkdir build && cd build
cmake .. -DLLAMA_METAL=on
cmake --build . --config Release -j 8
```

For Mac M3 Max with GPU acceleration:

```bash
cd /Users/Shared/models/llama.cpp
mkdir build && cd build
cmake .. -DLLAMA_METAL=on -DLLAMA_NATIVE=on
cmake --build . --config Release -j 8
```

### 3. Move Model Files

If you have existing models in the project's `models/` directory:

```bash
# Move .gguf model files to shared location
mv models/*.gguf /Users/Shared/models/
```

Or download models directly to the new location:

```bash
cd /Users/Shared/models
# Example: Download a model from Hugging Face
huggingface-cli download TheBloke/Llama-2-7B-Chat-GGUF llama-2-7b-chat.Q4_K_M.gguf --local-dir .
```

### 4. Verify Setup

Check that the binaries are accessible:

```bash
ls -lh /Users/Shared/models/llama.cpp/build/bin/llama-server
ls -lh /Users/Shared/models/llama.cpp/build/bin/llama-cli
```

Check that your models are in place:

```bash
ls -lh /Users/Shared/models/*.gguf
```

### 5. Update Configuration

The following files have been updated to use the new paths:

- `swarm-config.json` - Agent model paths
- `mlx_models.json` - Model registry
- `launch_matrix.sh` - Launch script
- `start_swarm.sh` - Swarm start script
- `swarm_launch.sh` - Swarm launch script
- `swarm-ctl` - Control utility
- `agent.cpp` - C++ agent
- `Dockerfile` - Docker configuration

No additional configuration changes should be needed.

### 6. Test the Setup

Generate the matrix script with new paths:

```bash
./swarm-ctl generate
```

Check the configuration:

```bash
./swarm-ctl config
./swarm-ctl models
```

Start the swarm:

```bash
./matrix up
```

Check status:

```bash
./matrix status
```

## Benefits of This Approach

1. **Centralized Storage**: All models in one shared location accessible by multiple projects
2. **Single llama.cpp Build**: One build of llama.cpp shared across projects
3. **Disk Space Savings**: No duplicate models or builds
4. **Easier Management**: Update llama.cpp once, benefit everywhere
5. **Better Organization**: Clear separation between project code and large binary assets

## Adding New Models

To add a new model to the system:

1. Download or copy the model to `/Users/Shared/models/`:
   ```bash
   cp path/to/new-model.gguf /Users/Shared/models/
   ```

2. Update `mlx_models.json` if you want to register it:
   ```json
   {
     "models": {
       "new-model": {
         "path": "/Users/Shared/models/new-model.gguf"
       }
     }
   }
   ```

3. Use `swarm-ctl` to assign it to an agent:
   ```bash
   ./swarm-ctl set architect /Users/Shared/models/new-model.gguf
   ./swarm-ctl generate
   ./swarm-ctl restart
   ```

## Updating llama.cpp

To update llama.cpp to a newer version:

```bash
cd /Users/Shared/models/llama.cpp
git pull
cd build
cmake --build . --config Release -j 8
```

Then restart your swarm:

```bash
./matrix down
./matrix up
```

## Troubleshooting

### Permission Issues

If you get permission errors:

```bash
sudo chown -R $(whoami):staff /Users/Shared/models
chmod -R 755 /Users/Shared/models
```

### Binary Not Found

If llama-server is not found, verify the build:

```bash
ls -lh /Users/Shared/models/llama.cpp/build/bin/
```

If the directory is empty, rebuild llama.cpp following step 2 above.

### Models Not Loading

Verify model paths in configuration:

```bash
./swarm-ctl config
```

Ensure models exist:

```bash
ls -lh /Users/Shared/models/*.gguf
```

### Port Already in Use

If ports are already in use:

```bash
./matrix down
# Wait a moment
./matrix up
```

Or manually kill processes:

```bash
pkill -f llama-server
lsof -ti:8080,8081,8082 | xargs kill -9
```
