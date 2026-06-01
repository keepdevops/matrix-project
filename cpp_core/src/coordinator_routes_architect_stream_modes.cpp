#include "coordinator_routes_architect_stream_modes.h"
#include "agent_stream.h"

#include <map>
#include <mutex>
#include <thread>

namespace {
static constexpr size_t TOKEN_BATCH_BYTES = 128;
}

void stream_parallel_agents(const std::vector<const Agent*>& parallel_agents,
                            const std::string& prompt,
                            std::atomic<bool>* cancel,
                            const WriteEventFn& write_event,
                            std::map<std::string, std::string>& outputs) {
    std::mutex out_mu;
    std::vector<std::thread> threads;
    threads.reserve(parallel_agents.size());
    for (const Agent* a : parallel_agents) {
        threads.emplace_back([a, &prompt, cancel, &write_event, &outputs, &out_mu]() {
            std::string assembled;
            std::string batch;
            auto flush_batch = [&]() {
                if (batch.empty()) return;
                write_event("token",
                    nlohmann::json({{"agent", a->name}, {"delta", batch}}).dump());
                batch.clear();
            };
            auto on_chunk = [&](const std::string& delta) {
                assembled += delta;
                batch    += delta;
                if (batch.size() >= TOKEN_BATCH_BYTES) flush_batch();
            };
            try {
                agent_stream::stream_agent(*a, a->system_prompt, prompt, on_chunk, cancel);
            } catch (const std::exception& e) {
                flush_batch();
                write_event("error",
                    nlohmann::json({{"agent", a->name}, {"error", e.what()}}).dump());
            }
            flush_batch();
            {
                std::lock_guard<std::mutex> lk(out_mu);
                outputs[a->name] = assembled;
            }
            write_event("agent_done", nlohmann::json({{"agent", a->name}}).dump());
        });
    }
    for (auto& t : threads) t.join();
}

void run_stream_broadcast_mode(const std::vector<Agent>& agents,
                               const std::string& synth_name,
                               const std::string& mode,
                               const Agent* synth_agent,
                               const std::string& prompt,
                               std::atomic<bool>* cancel,
                               const WriteEventFn& write_event,
                               std::map<std::string, std::string>& outputs,
                               std::vector<std::string>& participants) {
    std::vector<const Agent*> bcast;
    for (const auto& a : agents) {
        if (a.name == synth_name) continue;
        bcast.push_back(&a);
        participants.push_back(a.name);
    }
    stream_parallel_agents(bcast, prompt, cancel, write_event, outputs);
    if (mode == "cascade") {
        run_stream_synthesis(synth_agent, prompt, mode, participants, outputs, cancel, write_event);
    }
}
