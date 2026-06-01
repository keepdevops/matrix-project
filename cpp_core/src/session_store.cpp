#include "session_store.h"
#include "session_store_continuation.h"

#include <chrono>
#include <fstream>
#include <iostream>
#include <sstream>

using json = nlohmann::json;

namespace {

long long epoch_ms() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

}  // namespace

std::string session_new_id(const std::string& prefix) {
    static unsigned long counter = 0;
    std::ostringstream os;
    os << prefix << "_" << epoch_ms() << "_" << std::hex << ++counter;
    return os.str();
}

void session_load(json& sessions, const std::string& path) {
    std::ifstream f(path);
    if (!f.is_open()) {
        sessions = json::object();
        return;
    }
    try {
        json doc = json::parse(f);
        sessions = doc.is_object() ? doc : json::object();
    } catch (const std::exception& e) {
        std::cerr << "❌ Failed to parse sessions: " << e.what() << std::endl;
        sessions = json::object();
    }
}

void session_save(const json& sessions, const std::string& path) {
    std::ofstream f(path);
    if (!f.is_open()) {
        std::cerr << "❌ Failed to open sessions file for writing: " << path << std::endl;
        return;
    }
    f << sessions.dump(2);
}

SessionContinuation session_build_continuation(
    const json& sessions,
    const std::string& session_id,
    const std::string& followup,
    const json& context_policy) {
    return session_build_continuation_impl(sessions, session_id, followup, context_policy);
}

void session_append_run(json& sessions,
                        const std::string& session_id,
                        const json& run) {
    const long long now = epoch_ms();
    json& sess = sessions[session_id];
    if (!sess.is_object()) sess = json::object();
    sess["id"] = session_id;
    if (!sess.contains("created_at")) sess["created_at"] = now;
    sess["updated_at"] = now;
    if (!sess.contains("runs") || !sess["runs"].is_array()) sess["runs"] = json::array();
    sess["runs"].push_back(run);
}
