#pragma once
// Prompt template CRUD + render routes.
// Templates stored in CoordinatorState::templates (JSON object).

#include "coordinator_context.h"
#include "httplib.h"
#include "json.hpp"
#include <regex>
#include <string>

namespace tmpl_routes {

inline std::string substitute(const std::string& text,
                               const nlohmann::json& variables) {
    std::string result = text;
    static const std::regex var_re(R"(\{\{(\w+)\}\})");
    std::string out;
    auto it = std::sregex_iterator(result.begin(), result.end(), var_re);
    auto end = std::sregex_iterator();
    size_t last = 0;
    for (; it != end; ++it) {
        const auto& m = *it;
        out.append(result, last, m.position() - last);
        const std::string key = m[1].str();
        if (variables.contains(key) && variables[key].is_string())
            out += variables[key].get<std::string>();
        else
            out += m[0].str(); // leave unchanged if no value
        last = m.position() + m.length();
    }
    out.append(result, last, result.size() - last);
    return out;
}

} // namespace tmpl_routes

inline void register_coordinator_routes_templates(httplib::Server& svr,
                                                   CoordinatorState& st) {
    svr.Get("/api/templates", [&st](const httplib::Request&, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        std::lock_guard<std::mutex> lk(st.templates_mutex);
        res.set_content(st.templates.dump(), "application/json");
    });

    svr.Put(R"(/api/templates/([^/]+))",
            [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); }
        catch (...) {
            res.status = 400;
            res.set_content("{\"error\":\"invalid JSON\"}", "application/json");
            return;
        }
        if (!body.contains("text") || !body["text"].is_string()) {
            res.status = 400;
            res.set_content("{\"error\":\"text field required\"}", "application/json");
            return;
        }
        { std::lock_guard<std::mutex> lk(st.templates_mutex);
          st.templates[name] = body; }
        res.set_content(nlohmann::json({{"name", name}, {"saved", true}}).dump(),
                        "application/json");
    });

    svr.Delete(R"(/api/templates/([^/]+))",
               [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        bool removed = false;
        { std::lock_guard<std::mutex> lk(st.templates_mutex);
          removed = st.templates.erase(name) > 0; }
        res.set_content(nlohmann::json({{"name", name}, {"removed", removed}}).dump(),
                        "application/json");
    });

    svr.Post(R"(/api/templates/([^/]+)/render)",
             [&st](const httplib::Request& req, httplib::Response& res) {
        res.set_header("Access-Control-Allow-Origin", "*");
        const std::string name = req.matches[1];
        nlohmann::json tmpl;
        { std::lock_guard<std::mutex> lk(st.templates_mutex);
          if (!st.templates.contains(name)) {
              res.status = 404;
              res.set_content("{\"error\":\"template not found\"}", "application/json");
              return;
          }
          tmpl = st.templates[name]; }
        nlohmann::json body;
        try { body = nlohmann::json::parse(req.body); } catch (...) { body = {}; }
        const auto vars = body.value("variables", nlohmann::json::object());
        const std::string rendered = tmpl_routes::substitute(
            tmpl.value("text", ""), vars);
        res.set_content(nlohmann::json({{"rendered", rendered}}).dump(), "application/json");
    });
}
