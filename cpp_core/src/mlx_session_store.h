#pragma once
#ifdef MATRIX_MLX_NATIVE_COORD

// Thread-safe MLX session store — mirrors Python SessionStore interface.
// Idle eviction after max_idle_secs (default 300); LRU cap at max_sessions (50).
// No Metal cache objects in C++ MVP — pure message tracking.

#include "json.hpp"

#include <chrono>
#include <map>
#include <mutex>
#include <string>
#include <vector>

using json = nlohmann::json;

struct MlxSession {
    std::string session_id;
    std::vector<json> messages;
    std::chrono::steady_clock::time_point last_used;

    explicit MlxSession(std::string id = "")
        : session_id(std::move(id))
        , last_used(std::chrono::steady_clock::now()) {}

    void touch() { last_used = std::chrono::steady_clock::now(); }

    double idle_secs() const {
        using namespace std::chrono;
        return duration<double>(steady_clock::now() - last_used).count();
    }
};

class MlxSessionStore {
public:
    static constexpr int DEFAULT_IDLE_SECS    = 300;
    static constexpr int DEFAULT_MAX_SESSIONS = 50;

    explicit MlxSessionStore(int max_idle_secs    = DEFAULT_IDLE_SECS,
                              int max_sessions     = DEFAULT_MAX_SESSIONS)
        : max_idle_secs_(max_idle_secs)
        , max_sessions_(max_sessions) {}

    // Returns (or creates) a session. If at capacity, LRU-evicts the oldest.
    MlxSession& get_or_create(const std::string& session_id);

    void append_message(const std::string& session_id,
                        const std::string& role,
                        const std::string& content);

    // Returns copy (not reference) so callers can't hold a dangling ref.
    std::vector<json> get_messages(const std::string& session_id) const;

    // Returns true when the session existed and was removed.
    bool clear(const std::string& session_id);

    // Removes all sessions; returns count removed.
    int clear_all();

    // Evicts sessions idle longer than max_idle_secs; returns evicted count.
    int cleanup_idle();

    int  active_count() const;
    json snapshot()     const;   // [{session_id, messages, idle_secs}]

private:
    mutable std::mutex mu_;
    std::map<std::string, MlxSession> sessions_;
    int max_idle_secs_;
    int max_sessions_;

    // Evicts least-recently-used session; caller must hold mu_.
    void evict_lru_locked();
};

// Process-level singleton — one store shared across all MLX route handlers.
MlxSessionStore& mlx_sessions();

#endif  // MATRIX_MLX_NATIVE_COORD
