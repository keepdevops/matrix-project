#pragma once

#include "json.hpp"
#include "agent.h"

#include <atomic>
#include <condition_variable>
#include <deque>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

// Per-session conversation memory with background summarization.
//
// On append, if estimated tokens exceed the threshold and no compression is
// already in flight, a task is enqueued. A single worker thread dequeues
// tasks and calls the configured summarizer agent synchronously via
// call_agent_with_system. The returned summary replaces UniversalState's
// summary and the oldest turns are dropped, keeping `retain_tail` recent
// entries.
//
// Snapshots are immutable shared_ptrs: readers (snapshot_json) never block
// writers (append, apply_compressed) and vice versa. All mutation goes
// through `mu`.

struct UniversalState {
    struct Config {
        std::size_t token_threshold = 6144;
        std::size_t retain_tail = 4;
        std::size_t token_estimate_div = 4;
        std::string summarizer_agent = "memory-summarizer";
    };

    struct Snapshot {
        std::string summary;
        std::deque<nlohmann::json> history;
        std::uint64_t version = 0;
        std::string last_compressed_at;  // ISO-8601, empty if never
    };

    Config cfg;

    mutable std::mutex mu;
    std::shared_ptr<const Snapshot> current{std::make_shared<Snapshot>()};
    std::atomic<bool> compression_pending{false};

    void append(const nlohmann::json& entry);
    nlohmann::json snapshot_json() const;
    std::shared_ptr<const Snapshot> load_snapshot() const;

    // If a compression should run and none is in flight, sets
    // compression_pending=true and returns the prompt + sampled version.
    // The caller must eventually clear pending via apply_compressed() or
    // cancel_pending().
    bool check_and_isolate(std::string& out_prompt, std::uint64_t& out_version);

    // Replace summary + drop folded turns. Preserves any turns appended
    // during summarization (indexed by version delta).
    void apply_compressed(const std::string& new_summary,
                          std::uint64_t original_version);

    void cancel_pending();
};

class MemoryManager {
public:
    // `agents` must outlive the manager; `storage_dir` is copied.
    MemoryManager(std::string storage_dir, const std::vector<Agent>& agents);
    ~MemoryManager();

    MemoryManager(const MemoryManager&) = delete;
    MemoryManager& operator=(const MemoryManager&) = delete;

    std::shared_ptr<UniversalState> get_or_create(const std::string& session_id);

    // Append + persist + maybe enqueue compression. Sole entry point for
    // the request path.
    void append_turn(const std::string& session_id,
                     const nlohmann::json& entry);

    nlohmann::json snapshot_json(const std::string& session_id);

    // Load any memory_<session>.json files already on disk for the
    // "default" session, and one-time-migrate a legacy flat history.json
    // into that session if present.
    void load_existing();

private:
    struct Task {
        std::string session_id;
        std::weak_ptr<UniversalState> state;
        std::uint64_t version = 0;
        std::string prompt;
    };

    void worker_loop();
    void persist(const std::string& session_id,
                 const UniversalState& state) const;
    void migrate_legacy_history();
    const Agent* find_agent(const std::string& name) const;
    bool looks_like_error(const std::string& s) const;

    std::string storage_dir_;
    const std::vector<Agent>& agents_;

    mutable std::mutex map_mu_;
    std::unordered_map<std::string, std::shared_ptr<UniversalState>> sessions_;

    std::thread worker_;
    std::mutex queue_mu_;
    std::condition_variable queue_cv_;
    std::queue<Task> queue_;
    std::atomic<bool> shutdown_{false};
};
