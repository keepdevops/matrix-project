#pragma once
#include <string>

// Pre-flight validation for model files.
// Every function returns "" on success or a human-readable error on failure.

// ── llama backend (local GGUF files) ─────────────────────────────────────────

// Rule 1: file exists and is readable
std::string validate_model_exists(const std::string& path);

// Rule 2: first 4 bytes are the GGUF magic "GGUF"
std::string validate_gguf_magic(const std::string& path);

// Rule 3: GGUF KV metadata contains a non-empty "general.architecture"
// (diffusion models like Flux have an empty architecture field)
std::string validate_gguf_architecture(const std::string& path);

// Runs all three llama rules in order. Returns the first error found, or "".
std::string validate_llama_model(const std::string& path);

// ── mlx backend (local 4-bit directories or HuggingFace IDs) ─────────────────

// Rule 1: Python interpreter is executable
std::string validate_mlx_python(const std::string& interpreter_path);

// Rules 2–4: path is valid, required files present, config.json is a model config.
// HuggingFace IDs are rejected (air-gapped mode).
std::string validate_mlx_model(const std::string& model_path,
                                const std::string& interpreter_path);

// ── vllm backend (local HF-format safetensors directories) ───────────────────

// Rules 1–6: interpreter executable, no HF IDs, dir exists, not a GGUF,
// required files present, context <= max_position_embeddings.
std::string validate_vllm_model(const std::string& model_path,
                                 const std::string& interpreter_path,
                                 int context_window);

// ── docker-vllm backend (Docker Model Runner image tags) ─────────────────────

// Rules 1–2: model field non-empty, docker binary accessible.
std::string validate_docker_vllm_model(const std::string& model_id);
