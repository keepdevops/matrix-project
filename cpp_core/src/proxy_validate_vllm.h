#pragma once
#include <string>

std::string validate_vllm_model(const std::string& model_path,
                                 const std::string& interpreter_path,
                                 int context_window);

std::string validate_docker_vllm_model(const std::string& model_id);
