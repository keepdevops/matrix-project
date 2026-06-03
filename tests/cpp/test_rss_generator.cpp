// MS-69: RSS generator — XML shape, bounded buffer, threading.

#include "rss_generator.h"

#include <atomic>
#include <cassert>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

static bool has_substr(const std::string& hay, const std::string& needle) {
    return hay.find(needle) != std::string::npos;
}

int main() {
    rss_generator::configure(false, 3);
    assert(!rss_generator::is_enabled());
    const std::string off = rss_generator::to_rss_xml(
        rss_generator::Category::History, "http://test/history");
    assert(has_substr(off, "<?xml") && has_substr(off, "<rss version=\"2.0\">"));
    assert(!has_substr(off, "<item>"));

    rss_generator::configure(true, 3);
    assert(rss_generator::is_enabled());
    rss_generator::publish(rss_generator::Category::History, "a", "desc a");
    rss_generator::publish(rss_generator::Category::History, "b", "desc b");
    rss_generator::publish(rss_generator::Category::History, "c", "desc c");
    rss_generator::publish(rss_generator::Category::History, "d", "desc d");

    const std::string xml = rss_generator::to_rss_xml(
        rss_generator::Category::History, "http://test/history");
    assert(has_substr(xml, "<item><title>d</title>"));
    assert(has_substr(xml, "<item><title>c</title>"));
    assert(has_substr(xml, "<item><title>b</title>"));
    assert(!has_substr(xml, "<item><title>a</title>"));

    rss_generator::publish(rss_generator::Category::Config, "cfg", "a<b>", "/cfg");
    const std::string cfg = rss_generator::to_rss_xml(
        rss_generator::Category::Config, "http://test/config");
    assert(has_substr(cfg, "<link>/cfg</link>"));
    assert(has_substr(cfg, "a&lt;b&gt;"));
    assert(!has_substr(cfg, "a<b>"));

    std::atomic<int> published{0};
    std::vector<std::thread> workers;
    for (int i = 0; i < 8; ++i) {
        workers.emplace_back([&, i] {
            rss_generator::publish(rss_generator::Category::TokenRegulation,
                                   "t" + std::to_string(i), "d");
            published.fetch_add(1);
        });
    }
    for (auto& t : workers) t.join();
    assert(published.load() == 8);
    const std::string tok = rss_generator::to_rss_xml(
        rss_generator::Category::TokenRegulation, "http://test/token-regulation");
    assert(has_substr(tok, "<item>"));
    size_t items = 0;
    for (size_t pos = 0; (pos = tok.find("<item>", pos)) != std::string::npos; ++pos)
        ++items;
    assert(items <= 3);

    std::cout << "✅ test_rss_generator: all assertions passed\n";
    return 0;
}
