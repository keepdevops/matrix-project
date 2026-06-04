#pragma once

// Coordinator process state and persistence paths. HTTP: coordinator_routes_*.cpp.
// JSON shape checks at startup: config/coordinator_config_validate.h

#include "agent.h"
#include "agent_contract.h"
#include "context_gate.h"
#include "kv_auto_clear.h"
#include "mlx_memory_guard.h"
#include "token_budget_hierarchy.h"
#include "json.hpp"
#include "swarm_config_store.h"

#include <map>
#include <mutex>
#include <string>
#include <vector>

using json = nlohmann::json;

/// Owns coordinator process state previously scattered as statics in coordinator.cpp.
struct CoordinatorState {
    std::vector<Agent> agents;
    std::vector<json> history;
    std::mutex history_mutex;
    std::string history_path;

    json sessions = json::object();
    std::mutex sessions_mutex;
    std::string sessions_path;

    json modes_config = json::object();
    std::mutex modes_config_mutex;

    json presets = json::object();
    std::mutex presets_mutex;

    std::string config_path_global;
    std::string source_config_path_global;

    /// Root JSON loaded at startup (used for optional response-cache block).
    json startup_config;

    /// Hierarchical token budget (global → mode → agent).
    BudgetHierarchy token_budget_hierarchy;
    /// When true, dispatch returns HTTP 429 if the session ledger is in overrun.
    bool reject_on_overrun = false;
    /// Per-dispatch contract ledger (reset each run, guarded by contract_mutex).
    ContractLedger contract_ledger;

    // Keep backward-compat accessor for code that reads global_token_budget directly.
    int global_token_budget() const { return token_budget_hierarchy.global; }

    json       templates = json::object();
    std::mutex templates_mutex;

    std::map<std::string, json> annotations;
    std::mutex                  annotations_mutex;

    // Distillation app integration
    std::string distillation_push_url;
    double      distillation_quality_threshold = 0.6;

    // Supervisor policy engine
    bool       supervisor_enabled = false;
    json       supervisor_audit   = json::array();
    std::mutex supervisor_audit_mutex;

    context_gate::Config  context_gate_config;
    kv_auto_clear::Config kv_auto_clear_config;
    kv_auto_clear::State  kv_auto_clear_state;
    std::mutex            kv_auto_clear_mutex;
    mlx_mem_guard::Config mlx_memory_guard_config;

    SwarmPaths swarm_paths() const {
        return SwarmPaths{config_path_global, source_config_path_global};
    }
};

void coordinator_load_history(CoordinatorState& st);
void coordinator_save_history(CoordinatorState& st);
void coordinator_load_sessions(CoordinatorState& st);
void coordinator_save_sessions(CoordinatorState& st);

/// Caller must hold `st.modes_config_mutex` (same contract as legacy persist).
bool coordinator_persist_modes_locked(CoordinatorState& st);
