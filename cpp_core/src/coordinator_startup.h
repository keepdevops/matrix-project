#pragma once

struct CoordinatorState;

/// Load swarm config, validate, populate agents/modes/presets, history/sessions paths.
/// Returns false on fatal startup error (caller should exit non-zero).
bool coordinator_startup(CoordinatorState& state, int argc, char* argv[]);
