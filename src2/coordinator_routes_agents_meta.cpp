#include "coordinator_routes_includes.h"
#include "coordinator_routes_internal.h"

void register_coordinator_routes_agents_meta(httplib::Server& svr, CoordinatorState& st) {
    // 4c2. Agent prompt editing — change an agent's system_prompt at runtime.
    // Persists to active config + mirror; survives restart and redeploy.
    // PUT /api/agents/<name>/prompt {"system_prompt": "..."}
    svr.Put(R"(/api/agents/([A-Za-z0-9_\-]+)/prompt)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        try {
            auto body = json::parse(req.body);
            if (!body.contains("system_prompt") || !body["system_prompt"].is_string()) {
                res.status = 400;
                res.set_content(json({{"error","missing 'system_prompt' string"}}).dump(),
                                "application/json");
                return;
            }
            // Reject names not in the persisted roster (project swarm-config or
            // active file). Upsert still applies once the name is valid.
            if (!agent_name_in_persisted_roster(st.swarm_paths(), name)) {
                res.status = 404;
                res.set_content(json({{"error","unknown agent"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            const std::string new_prompt = body["system_prompt"].get<std::string>();

            DualWriteOutcome dw = persist_agent_system_prompt(st.swarm_paths(), name, new_prompt);
            bool active_ok = dw.active_ok;
            bool source_ok = dw.source_ok;

            // Best-effort in-memory update so live st.agents pick up the change now.
            bool live_ok = false;
            for (auto& a : st.agents) if (a.name == name) { a.system_prompt = new_prompt; live_ok = true; break; }

            if (!active_ok && !source_ok && !live_ok) {
                res.status = 500;
                res.set_content(json({{"error","failed to persist prompt"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            std::cout << "✏️  [agents/" << name << "/prompt] updated ("
                      << new_prompt.size() << " chars)";
            if (!active_ok)  std::cout << " — active write skipped/FAILED";
            if (!st.source_config_path_global.empty() && !source_ok)
                std::cout << " — source write FAILED";
            std::cout << std::endl;
            response_cache::clear();  // old cached responses came from old prompt
            res.set_content(json({
                {"name", name},
                {"system_prompt", new_prompt},
                {"persisted", active_ok || source_ok},
                {"live", live_ok}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [agents prompt PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 4c2b. Agent description editing — short role description shown in UI
    // and prepended to system_prompt at request time. Persists like /prompt.
    // PUT /api/agents/<name>/description {"description": "..."}
    svr.Put(R"(/api/agents/([A-Za-z0-9_\-]+)/description)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        try {
            auto body = json::parse(req.body);
            if (!body.contains("description") || !body["description"].is_string()) {
                res.status = 400;
                res.set_content(json({{"error","missing 'description' string"}}).dump(),
                                "application/json");
                return;
            }
            if (!agent_name_in_persisted_roster(st.swarm_paths(), name)) {
                res.status = 404;
                res.set_content(json({{"error","unknown agent"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            const std::string new_desc = body["description"].get<std::string>();

            DualWriteOutcome dwd = persist_agent_description(st.swarm_paths(), name, new_desc);
            bool active_ok = dwd.active_ok;
            bool source_ok = dwd.source_ok;

            bool live_ok = false;
            for (auto& a : st.agents) if (a.name == name) { a.description = new_desc; live_ok = true; break; }

            if (!active_ok && !source_ok && !live_ok) {
                res.status = 500;
                res.set_content(json({{"error","failed to persist description"},{"name",name}}).dump(),
                                "application/json");
                return;
            }
            std::cout << "✏️  [agents/" << name << "/description] updated ("
                      << new_desc.size() << " chars)";
            if (!active_ok)  std::cout << " — active write skipped/FAILED";
            if (!st.source_config_path_global.empty() && !source_ok)
                std::cout << " — source write FAILED";
            std::cout << std::endl;
            response_cache::clear();
            res.set_content(json({
                {"name", name},
                {"description", new_desc},
                {"persisted", active_ok || source_ok},
                {"live", live_ok}
            }).dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [agents description PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });

    // 4c3. Agent token budgets — change an agent's max_tokens (runtime) and
    // context (next-deploy) without editing JSON by hand. Persists to active
    // config + mirror; survives restart and redeploy.
    // PUT /api/agents/<name>/tokens {"max_tokens": int, "context"?: int}
    svr.Put(R"(/api/agents/([A-Za-z0-9_\-]+)/tokens)",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        if (!agent_name_in_persisted_roster(st.swarm_paths(), name)) {
            res.status = 404;
            res.set_content(json({{"error","unknown agent"},{"name",name}}).dump(),
                            "application/json");
            return;
        }
        Agent* target = nullptr;
        for (auto& a : st.agents) if (a.name == name) { target = &a; break; }
        // Missing live target is OK — token fields are upserted into the on-disk
        // config for the next deploy; runtime fields apply when the agent is running.
        try {
            auto body = json::parse(req.body);
            const bool has_max = body.contains("max_tokens") && body["max_tokens"].is_number_integer();
            const bool has_ctx = body.contains("context") && body["context"].is_number_integer();
            const bool has_to  = body.contains("read_timeout_secs") && body["read_timeout_secs"].is_number_integer();
            if (!has_max && !has_ctx && !has_to) {
                res.status = 400;
                res.set_content(json({{"error","need integer 'max_tokens', 'context', or 'read_timeout_secs'"}}).dump(),
                                "application/json");
                return;
            }
            int new_max = has_max ? body["max_tokens"].get<int>() : -1;
            int new_ctx = has_ctx ? body["context"].get<int>() : -1;
            int new_to  = has_to  ? body["read_timeout_secs"].get<int>() : -1;
            if (has_max && (new_max < 64 || new_max > 131072)) {
                res.status = 400;
                res.set_content(json({{"error","max_tokens out of range [64,131072]"}}).dump(),
                                "application/json");
                return;
            }
            if (has_ctx && (new_ctx < 512 || new_ctx > 262144)) {
                res.status = 400;
                res.set_content(json({{"error","context out of range [512,262144]"}}).dump(),
                                "application/json");
                return;
            }
            if (has_to && (new_to < 30 || new_to > 7200)) {
                res.status = 400;
                res.set_content(json({{"error","read_timeout_secs out of range [30,7200]"}}).dump(),
                                "application/json");
                return;
            }

            // Auto-bump timeout when max_tokens is raised past 4096 without an
            // explicit timeout: heuristic min = max_tokens/20 + 30s (assumes
            // ~20 tok/s sustained throughput plus a 30s buffer). Only raises,
            // never lowers — respects manual values above the heuristic.
            bool auto_bumped_timeout = false;
            if (has_max && !has_to && new_max > 4096) {
                int min_to = new_max / 20 + 30;
                int prior_to = target ? target->read_timeout_secs : 0;
                if (prior_to < min_to) {
                    new_to = min_to;
                    auto_bumped_timeout = true;
                }
            }
            const bool apply_to = has_to || auto_bumped_timeout;

            if (target && has_max) target->max_tokens = new_max;
            if (target && apply_to) target->read_timeout_secs = new_to;
            // context has no runtime field — only persisted; takes effect on next deploy.

            TokenPersistParams tp;
            tp.has_max = has_max;
            tp.max_tokens = new_max;
            tp.has_ctx = has_ctx;
            tp.context = new_ctx;
            tp.apply_read_timeout = apply_to;
            tp.read_timeout_secs = new_to;
            DualWriteOutcome dwtok = persist_agent_tokens(st.swarm_paths(), name, tp);
            bool active_ok = dwtok.active_ok;
            bool source_ok = dwtok.source_ok;
            std::cout << "🔢 [agents/" << name << "/tokens] ";
            if (has_max) std::cout << "max_tokens=" << new_max << " ";
            if (has_ctx) std::cout << "context=" << new_ctx << " (next deploy) ";
            if (apply_to) std::cout << "read_timeout_secs=" << new_to
                                    << (auto_bumped_timeout ? " (auto)" : "") << " ";
            if (!active_ok) std::cout << " — active write FAILED";
            if (!source_ok) std::cout << " — source write FAILED";
            std::cout << std::endl;
            json resp = {{"name", name}, {"persisted", active_ok && source_ok}};
            if (has_max) resp["max_tokens"] = new_max;
            if (has_ctx) {
                resp["context"] = new_ctx;
                resp["context_pending_redeploy"] = true;
            }
            if (apply_to) {
                resp["read_timeout_secs"] = new_to;
                if (auto_bumped_timeout) resp["read_timeout_auto_bumped"] = true;
            }
            res.set_content(resp.dump(), "application/json");
        } catch (const std::exception& e) {
            std::cerr << "❌ [agents tokens PUT] " << e.what() << std::endl;
            res.status = 400;
            res.set_content(json({{"error", e.what()}}).dump(), "application/json");
        }
    });
}
