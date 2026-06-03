#pragma once
// MS-69: RSS 2.0 feeds — registered only when rss.enabled.

#include "coordinator_routes_includes.h"
#include "rss_generator.h"

namespace rss_routes {

inline void register_routes(httplib::Server& svr) {
    if (!rss_generator::is_enabled()) return;

    auto feed = [](rss_generator::Category cat) {
        return [cat](const httplib::Request&, httplib::Response& res) {
            res.set_header("Access-Control-Allow-Origin", "*");
            const std::string link = "http://127.0.0.1:8000/api/rss/"
                + std::string(rss_generator::category_path(cat));
            res.set_content(rss_generator::to_rss_xml(cat, link), "application/rss+xml");
        };
    };

    svr.Get("/api/rss/history", feed(rss_generator::Category::History));
    svr.Get("/api/rss/config", feed(rss_generator::Category::Config));
    svr.Get("/api/rss/token-regulation", feed(rss_generator::Category::TokenRegulation));
}

}  // namespace rss_routes
