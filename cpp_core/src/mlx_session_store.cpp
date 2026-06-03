#ifdef MATRIX_MLX_NATIVE_COORD
#include "mlx_session_store.h"

#include <algorithm>
#include <iostream>

// ── MlxSessionStore methods ───────────────────────────────────────────────────

MlxSession& MlxSessionStore::get_or_create(const std::string& session_id) {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = sessions_.find(session_id);
    if (it != sessions_.end()) {
        it->second.touch();
        return it->second;
    }
    if (static_cast<int>(sessions_.size()) >= max_sessions_) {
        evict_lru_locked();
    }
    sessions_.emplace(session_id, MlxSession(session_id));
    std::cout << "🧩 [mlx-session] created " << session_id << std::endl;
    return sessions_.at(session_id);
}

void MlxSessionStore::append_message(const std::string& session_id,
                                     const std::string& role,
                                     const std::string& content) {
    std::lock_guard<std::mutex> lk(mu_);
    auto& sess = sessions_[session_id];
    if (sess.session_id.empty()) sess.session_id = session_id;
    sess.messages.push_back({{"role", role}, {"content", content}});
    sess.touch();
}

std::vector<json> MlxSessionStore::get_messages(const std::string& session_id) const {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return {};
    return it->second.messages;  // copy
}

bool MlxSessionStore::clear(const std::string& session_id) {
    std::lock_guard<std::mutex> lk(mu_);
    auto it = sessions_.find(session_id);
    if (it == sessions_.end()) return false;
    std::cout << "🧩 [mlx-session] cleared " << session_id << std::endl;
    sessions_.erase(it);
    return true;
}

int MlxSessionStore::clear_all() {
    std::lock_guard<std::mutex> lk(mu_);
    const int count = static_cast<int>(sessions_.size());
    sessions_.clear();
    return count;
}

int MlxSessionStore::cleanup_idle() {
    std::lock_guard<std::mutex> lk(mu_);
    int evicted = 0;
    for (auto it = sessions_.begin(); it != sessions_.end(); ) {
        if (it->second.idle_secs() > max_idle_secs_) {
            std::cout << "🧩 [mlx-session] idle-evict " << it->first
                      << " (idle " << static_cast<int>(it->second.idle_secs())
                      << "s > " << max_idle_secs_ << "s)" << std::endl;
            it = sessions_.erase(it);
            ++evicted;
        } else {
            ++it;
        }
    }
    return evicted;
}

int MlxSessionStore::active_count() const {
    std::lock_guard<std::mutex> lk(mu_);
    return static_cast<int>(sessions_.size());
}

json MlxSessionStore::snapshot() const {
    std::lock_guard<std::mutex> lk(mu_);
    json arr = json::array();
    for (const auto& [id, sess] : sessions_) {
        arr.push_back({
            {"session_id", id},
            {"messages",   static_cast<int>(sess.messages.size())},
            {"idle_secs",  static_cast<int>(sess.idle_secs())},
        });
    }
    return arr;
}

void MlxSessionStore::evict_lru_locked() {
    if (sessions_.empty()) return;
    auto oldest = std::min_element(sessions_.begin(), sessions_.end(),
        [](const auto& a, const auto& b) {
            return a.second.last_used < b.second.last_used;
        });
    std::cout << "🧩 [mlx-session] LRU-evict " << oldest->first
              << " (cap=" << max_sessions_ << ")" << std::endl;
    sessions_.erase(oldest);
}

// ── Singleton ─────────────────────────────────────────────────────────────────

MlxSessionStore& mlx_sessions() {
    static MlxSessionStore store;
    return store;
}

#endif  // MATRIX_MLX_NATIVE_COORD
