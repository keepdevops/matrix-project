#include "memory_state.h"
#include "agent_client.h"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <iostream>
#include <sstream>

using nlohmann::json;

namespace {

std::string iso8601_now() {
    auto t = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now());
    std::tm tm{};
    gmtime_r(&t, &tm);
    char buf[32];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &tm);
    return buf;
}

constexpr const char* kSummarizerSystem =
    "You are a precise memory compressor for a multi-agent swarm. "
    "Fold the new turns into the existing summary. Preserve concrete "
    "decisions, file paths, identifiers, open questions, and error reasons. "
    "Drop pleasantries. Output the new summary only — no preamble, no "
    "markdown headings.";

}  // namespace

// ── UniversalState ───────────────────────────────────────────────────────────

void UniversalState::append(const json& entry) {
    std::lock_guard<std::mutex> lock(mu);
    auto fresh = std::make_shared<Snapshot>(*current);
    fresh->history.push_back(entry);
    fresh->version++;
    current = fresh;
}

std::shared_ptr<const UniversalState::Snapshot>
UniversalState::load_snapshot() const {
    std::lock_guard<std::mutex> lock(mu);
    return current;
}

json UniversalState::snapshot_json() const {
    auto snap = load_snapshot();
    json j;
    j["summary"] = snap->summary;
    j["recent"] = json::array();
    for (const auto& m : snap->history) j["recent"].push_back(m);
    j["version"] = snap->version;
    j["last_compressed"] = snap->last_compressed_at;
    j["compression_pending"] = compression_pending.load();
    return j;
}

bool UniversalState::check_and_isolate(std::string& out_prompt,
                                       std::uint64_t& out_version) {
    if (compression_pending.exchange(true)) return false;

    auto snap = load_snapshot();
    if (snap->history.size() <= cfg.retain_tail) {
        compression_pending = false;
        return false;
    }

    // Single-pass byte/N estimate. dump() already includes structural
    // punctuation; the earlier draft's extra count_if pass double-counted.
    std::size_t tokens = snap->summary.size() / cfg.token_estimate_div;
    for (const auto& msg : snap->history) {
        tokens += msg.dump().size() / cfg.token_estimate_div;
    }
    if (tokens <= cfg.token_threshold) {
        compression_pending = false;
        return false;
    }

    std::ostringstream oss;
    oss << "Existing summary:\n"
        << (snap->summary.empty() ? "[none]" : snap->summary)
        << "\n\nNew turns to fold:\n";
    const std::size_t fold_count = snap->history.size() - cfg.retain_tail;
    for (std::size_t i = 0; i < fold_count; ++i) {
        oss << snap->history[i].dump() << "\n";
    }

    out_prompt = oss.str();
    out_version = snap->version;
    return true;
}

void UniversalState::apply_compressed(const std::string& new_summary,
                                      std::uint64_t original_version) {
    std::lock_guard<std::mutex> lock(mu);

    // Only drop the turns that existed at sample time. Anything appended
    // during summarization is preserved by version delta, which fixes the
    // starvation case from the earlier draft.
    if (current->version < original_version) {
        compression_pending = false;
        return;
    }
    const std::uint64_t turns_added = current->version - original_version;
    if (current->history.size() < cfg.retain_tail + turns_added) {
        compression_pending = false;
        return;
    }
    const std::size_t fold_count =
        current->history.size() - cfg.retain_tail - turns_added;
    if (fold_count == 0) {
        compression_pending = false;
        return;
    }

    auto fresh = std::make_shared<Snapshot>(*current);
    fresh->summary = new_summary;
    fresh->last_compressed_at = iso8601_now();
    for (std::size_t i = 0; i < fold_count && !fresh->history.empty(); ++i) {
        fresh->history.pop_front();
    }
    fresh->version++;
    current = fresh;
    compression_pending = false;
}

void UniversalState::cancel_pending() { compression_pending = false; }

// ── MemoryManager ────────────────────────────────────────────────────────────

MemoryManager::MemoryManager(std::string storage_dir,
                             const std::vector<Agent>& agents)
    : storage_dir_(std::move(storage_dir)), agents_(agents) {
    worker_ = std::thread(&MemoryManager::worker_loop, this);
}

MemoryManager::~MemoryManager() {
    shutdown_ = true;
    queue_cv_.notify_all();
    if (worker_.joinable()) worker_.join();
}

std::shared_ptr<UniversalState>
MemoryManager::get_or_create(const std::string& session_id) {
    std::lock_guard<std::mutex> lock(map_mu_);
    auto it = sessions_.find(session_id);
    if (it != sessions_.end()) return it->second;
    auto s = std::make_shared<UniversalState>();
    sessions_[session_id] = s;
    return s;
}

void MemoryManager::append_turn(const std::string& session_id,
                                const json& entry) {
    auto state = get_or_create(session_id);
    state->append(entry);
    persist(session_id, *state);

    std::string prompt;
    std::uint64_t version = 0;
    if (!state->check_and_isolate(prompt, version)) return;

    {
        std::lock_guard<std::mutex> lock(queue_mu_);
        queue_.push(Task{session_id, state, version, std::move(prompt)});
    }
    queue_cv_.notify_one();
}

json MemoryManager::snapshot_json(const std::string& session_id) {
    return get_or_create(session_id)->snapshot_json();
}

void MemoryManager::worker_loop() {
    while (!shutdown_) {
        Task task;
        {
            std::unique_lock<std::mutex> lock(queue_mu_);
            queue_cv_.wait(lock,
                           [&] { return shutdown_ || !queue_.empty(); });
            if (shutdown_ && queue_.empty()) return;
            task = std::move(queue_.front());
            queue_.pop();
        }

        auto state = task.state.lock();
        if (!state) continue;

        const Agent* agent = find_agent(state->cfg.summarizer_agent);
        if (!agent) {
            std::cerr << "❌ [memory] summarizer agent '"
                      << state->cfg.summarizer_agent
                      << "' not in config; skipping compression\n";
            state->cancel_pending();
            continue;
        }

        const std::string result =
            call_agent_with_system(*agent, kSummarizerSystem, task.prompt);
        if (looks_like_error(result)) {
            std::cerr << "❌ [memory] summarizer call failed: "
                      << result.substr(0, 200) << "\n";
            state->cancel_pending();
            continue;
        }

        state->apply_compressed(result, task.version);
        persist(task.session_id, *state);
    }
}

void MemoryManager::persist(const std::string& session_id,
                            const UniversalState& state) const {
    auto snap = state.load_snapshot();
    json out;
    out["summary"] = snap->summary;
    out["history"] = json::array();
    for (const auto& m : snap->history) out["history"].push_back(m);
    out["version"] = snap->version;
    out["last_compressed"] = snap->last_compressed_at;

    const std::string final_path =
        storage_dir_ + "/memory_" + session_id + ".json";
    const std::string tmp_path = final_path + ".tmp";

    {
        std::ofstream f(tmp_path);
        if (!f.is_open()) {
            std::cerr << "❌ [memory] cannot open " << tmp_path
                      << " for write\n";
            return;
        }
        f << out.dump(2);
    }
    if (std::rename(tmp_path.c_str(), final_path.c_str()) != 0) {
        std::cerr << "❌ [memory] rename failed: " << tmp_path << " -> "
                  << final_path << "\n";
    }
}

void MemoryManager::load_existing() {
    migrate_legacy_history();

    const std::string path = storage_dir_ + "/memory_default.json";
    std::ifstream f(path);
    if (!f.is_open()) return;
    try {
        json j = json::parse(f);
        auto state = get_or_create("default");
        std::lock_guard<std::mutex> lock(state->mu);
        auto fresh = std::make_shared<UniversalState::Snapshot>();
        fresh->summary = j.value("summary", "");
        if (j.contains("history") && j["history"].is_array()) {
            for (const auto& m : j["history"]) fresh->history.push_back(m);
        }
        fresh->version = j.value("version", static_cast<std::uint64_t>(0));
        fresh->last_compressed_at = j.value("last_compressed", "");
        state->current = fresh;
    } catch (const std::exception& e) {
        std::cerr << "❌ [memory] parse " << path << ": " << e.what() << "\n";
    }
}

void MemoryManager::migrate_legacy_history() {
    const std::string legacy = storage_dir_ + "/history.json";
    const std::string marker = legacy + ".migrated";
    {
        std::ifstream m(marker);
        if (m.good()) return;
    }
    std::ifstream f(legacy);
    if (!f.is_open()) return;

    json j;
    try {
        j = json::parse(f);
    } catch (const std::exception& e) {
        std::cerr << "❌ [memory] legacy parse: " << e.what() << "\n";
        return;
    }
    if (!j.is_array()) return;  // already new format or unrecognized

    auto state = get_or_create("default");
    {
        std::lock_guard<std::mutex> lock(state->mu);
        auto fresh = std::make_shared<UniversalState::Snapshot>();
        for (const auto& m : j) fresh->history.push_back(m);
        fresh->version = fresh->history.size();
        state->current = fresh;
    }
    persist("default", *state);

    std::ofstream(marker) << iso8601_now() << "\n";
    std::cout << "📜 [memory] migrated " << j.size()
              << " legacy entries into session 'default'\n";
}

const Agent* MemoryManager::find_agent(const std::string& name) const {
    for (const auto& a : agents_) {
        if (a.name == name) return &a;
    }
    return nullptr;
}

bool MemoryManager::looks_like_error(const std::string& s) const {
    // call_agent / call_agent_with_system return error text in-band. Tune
    // these markers after grepping agent_client.cpp for the actual prefixes;
    // false positives here will overwrite a valid summary with rejected
    // output, so err on the side of stricter matches (rare prefixes only).
    if (s.empty()) return true;
    static constexpr const char* kMarkers[] = {"❌", "[error]", "[Error]"};
    for (const char* m : kMarkers) {
        if (s.find(m) != std::string::npos) return true;
    }
    return false;
}
