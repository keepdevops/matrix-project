#pragma once

#include <string>

namespace coordinator_config {

// Expand a model/file path so configs are portable across machines.
//
// Two transformations, applied in order:
//  1. Substitute `${MATRIX_MODEL_DIR}` or `$MATRIX_MODEL_DIR` with the env value
//     (no-op if the env var is unset or empty).
//  2. If `MATRIX_MODEL_DIR` is set AND the path starts with the legacy default
//     `/Users/Shared/llama/models/`, rewrite the prefix to `${MATRIX_MODEL_DIR}/`.
//     This makes the bundled swarm-config*.json files portable without edits.
//
// Returns the path unchanged when no transformation applies.
std::string expand_model_path(const std::string& path);

}  // namespace coordinator_config
