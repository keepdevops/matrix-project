#include "session_store.h"
#include "session_store_text.h"

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

const json* latest_run_for_session(const json& sessions, const std::string& session_id) {
    if (!sessions.is_object() || !sessions.contains(session_id)) return nullptr;
    const json& sess = sessions[session_id];
    if (!sess.contains("runs") || !sess["runs"].is_array() || sess["runs"].empty()) return nullptr;
    return &sess["runs"].back();
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
    if (!f.is_open()) { sessions = json::object(); return; }
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
    SessionContinuation out;
    const json* prev = latest_run_for_session(sessions, session_id);
    if (!prev) {
        out.prompt = followup;
        out.compaction = {{"used", false}, {"reason", "session_not_found"}};
        return out;
    }

    const size_t max_context_chars = context_policy.value("max_context_chars", 24000);
    const std::string target_agent = context_policy.value("target_agent", std::string("programmer"));
    const bool include_final    = include_name(context_policy, "final");
    const bool include_original = include_name(context_policy, "original_prompt");
    const bool include_target   = include_name(context_policy, target_agent);
    bool compacted = false;

    const std::string original = first_prompt_for_session(sessions, session_id);
    std::ostringstream os;
    os << "You are continuing an existing Matrix Swarm session. "
       << "Use the prior context below, then answer the new follow-up. "
       << "Do not restart from scratch unless the follow-up asks you to.\n";

    if (include_original) {
        const size_t budget = max_context_chars / 5;
        compacted = compacted || original.size() > budget;
        append_section(os, "Original user request", trim_block(original, budget));
    }
    if (include_final) {
        const std::string final = json_string(*prev, "final");
        const size_t budget = max_context_chars / 4;
        compacted = compacted || final.size() > budget;
        append_section(os, "Previous final answer", trim_block(final, budget));
    }
    if (prev->contains("agents") && (*prev)["agents"].is_object()) {
        const json& agents = (*prev)["agents"];
        if (include_target && agents.contains(target_agent) && agents[target_agent].is_string()) {
            const std::string target = agents[target_agent].get<std::string>();
            const size_t budget = max_context_chars / 2;
            compacted = compacted || target.size() > budget;
            append_section(os, "Previous " + target_agent + " answer",
                           trim_block(target, budget));
        }
        std::ostringstream summary;
        for (auto it = agents.begin(); it != agents.end(); ++it) {
            if (it.key() == target_agent || !it.value().is_string()) continue;
            compacted = compacted || it.value().get<std::string>().size() > 900;
            summary << "- " << it.key() << ": "
                    << first_lines(it.value().get<std::string>(), 3, 900) << "\n";
        }
        append_section(os, "Other previous agent notes", summary.str());
    }

    append_section(os, "User follow-up", followup);
    os << "\n\nContinue from the previous answer. Add concrete detail and preserve useful prior work.";

    std::string built = os.str();
    if (built.size() > max_context_chars) {
        compacted = true;
        const size_t followup_budget = std::min<size_t>(followup.size(), max_context_chars / 4);
        built = trim_block(built, max_context_chars - followup_budget)
            + "\n\n## User follow-up\n"
            + trim_block(followup, followup_budget);
    }

    out.prompt = built;
    out.compaction = {
        {"used",              compacted},
        {"max_context_chars", max_context_chars},
        {"original_chars",    original.size()},
        {"built_chars",       built.size()},
        {"target_agent",      target_agent}
    };
    return out;
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
