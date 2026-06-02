#pragma once
// Agent contract primitives: conservation laws, delegation caps, audit trail.
// Each agent in a dispatch run gets a contract tracking its allocation vs. usage.

#include "json.hpp"
#include <chrono>
#include <map>
#include <mutex>
#include <string>
#include <vector>

struct AgentContract {
    std::string agent_name;
    int token_allocation  = 0;   // from budget hierarchy; 0 = unlimited
    int tokens_used       = 0;
    int max_delegations   = 1;   // sub-calls this agent may initiate
    int delegations_used  = 0;

    bool overrun()     const { return token_allocation > 0 && tokens_used > token_allocation; }
    bool can_delegate() const { return delegations_used < max_delegations; }

    nlohmann::json to_json() const {
        return {
            {"agent",            agent_name},
            {"allocation",       token_allocation},
            {"used",             tokens_used},
            {"overrun",          overrun()},
            {"delegations_used", delegations_used},
            {"max_delegations",  max_delegations},
        };
    }
};

struct ContractAuditEntry {
    std::string agent, event, run_id;
    int         tokens;
    long long   timestamp_ms;
};

struct ContractLedger {
    std::map<std::string, AgentContract> contracts;
    std::vector<ContractAuditEntry>      audit;
    std::mutex                           mu;

    void init(const std::string& agent_name, int allocation, int max_del = 1) {
        std::lock_guard<std::mutex> lk(mu);
        auto& c = contracts[agent_name];
        c.agent_name      = agent_name;
        c.token_allocation = allocation;
        c.max_delegations  = max_del;
    }

    void record(const std::string& agent, const std::string& event,
                int tokens, const std::string& run_id) {
        long long now = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        std::lock_guard<std::mutex> lk(mu);
        auto& c = contracts[agent];
        c.agent_name  = agent;
        c.tokens_used += tokens;
        if (event == "delegate") c.delegations_used++;
        if (audit.size() < 1000) audit.push_back({agent, event, run_id, tokens, now});
    }

    nlohmann::json snapshot() const {
        auto arr = nlohmann::json::array();
        for (const auto& [k, v] : contracts) arr.push_back(v.to_json());
        return arr;
    }

    bool any_overrun() const {
        for (const auto& [k, v] : contracts) if (v.overrun()) return true;
        return false;
    }
};
