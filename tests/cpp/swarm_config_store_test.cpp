/**
 * Standalone unit tests for swarm_config_store (no coordinator subprocess).
 * Built by scripts/build_cpp_binaries.sh (same step builds coordinator + proxy).
 */
#include "swarm_config_store.h"

#include <cassert>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace fs = std::filesystem;

static std::string unique_tmp_prefix() {
    return std::string("swarm_store_test_") + std::to_string(std::time(nullptr)) + "_";
}

static void write_file(const fs::path& p, const std::string& content) {
    std::ofstream out(p);
    out << content;
}

static std::string minimal_agent(const std::string& name, int port = 8080) {
    return std::string(R"({"name":")") + name + R"(","port":)" + std::to_string(port) +
           R"(,"read_timeout_secs":60,"max_tokens":256,"system_prompt":"x","engine":"llama","backend":"llama"})";
}

static void test_roster_membership_single_file() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "a");
    fs::create_directories(dir);
    fs::path cfg = dir / "cfg.json";
    write_file(cfg, std::string(R"({"agents":[)") + minimal_agent("alice") + "," + minimal_agent("bob") +
                               R"(],"coordinator":{}})");

    SwarmPaths p{cfg.string(), ""};
    assert(agent_name_in_persisted_roster(p, "alice"));
    assert(agent_name_in_persisted_roster(p, "bob"));
    assert(!agent_name_in_persisted_roster(p, "ghost"));

    fs::remove_all(dir);
}

static void test_roster_prefers_source_path() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "b");
    fs::create_directories(dir);
    fs::path active = dir / "active.json";
    fs::path source = dir / "source.json";
    write_file(active, std::string(R"({"agents":[)") + minimal_agent("only_active") + R"(],"coordinator":{}})");
    write_file(source, std::string(R"({"agents":[)") + minimal_agent("only_source") + R"(],"coordinator":{}})");

    SwarmPaths p{active.string(), source.string()};
    assert(agent_name_in_persisted_roster(p, "only_source"));
    assert(!agent_name_in_persisted_roster(p, "only_active"));

    fs::remove_all(dir);
}

static void test_persist_prompt_roundtrip() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "c");
    fs::create_directories(dir);
    fs::path cfg = dir / "cfg.json";
    write_file(cfg, std::string(R"({"agents":[)") + minimal_agent("ed") + R"(],"coordinator":{}})");

    SwarmPaths p{cfg.string(), ""};
    DualWriteOutcome o = persist_agent_system_prompt(p, "ed", "new system text");
    assert(o.active_ok);

    json doc;
    assert(read_swarm_config_doc(cfg.string(), doc));
    bool found = false;
    for (auto& a : doc["agents"]) {
        if (a["name"] == "ed" && a["system_prompt"] == "new system text") found = true;
    }
    assert(found);

    fs::remove_all(dir);
}

static void test_dual_path_mirror_prompt() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "d");
    fs::create_directories(dir);
    fs::path active = dir / "active.json";
    fs::path source = dir / "source.json";
    std::string base = std::string(R"({"agents":[)") + minimal_agent("x") + R"(],"coordinator":{}})";
    write_file(active, base);
    write_file(source, base);

    SwarmPaths p{active.string(), source.string()};
    DualWriteOutcome o = persist_agent_description(p, "x", "role blurb");
    assert(o.active_ok && o.source_ok);

    json da, ds;
    assert(read_swarm_config_doc(active.string(), da));
    assert(read_swarm_config_doc(source.string(), ds));
    assert(da["agents"][0]["description"] == "role blurb");
    assert(ds["agents"][0]["description"] == "role blurb");

    fs::remove_all(dir);
}

static void test_persist_tokens_source_optional() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "e");
    fs::create_directories(dir);
    fs::path cfg = dir / "cfg.json";
    write_file(cfg, std::string(R"({"agents":[)") + minimal_agent("t") + R"(],"coordinator":{}})");

    SwarmPaths p{cfg.string(), ""};
    TokenPersistParams tp;
    tp.has_max = true;
    tp.max_tokens = 8192;
    DualWriteOutcome o = persist_agent_tokens(p, "t", tp);
    assert(o.active_ok);
    assert(o.source_ok); // no source path => treated as success for tokens

    fs::remove_all(dir);
}

static void test_external_edit_visible_after_mtime_change() {
    fs::path dir = fs::temp_directory_path() / (unique_tmp_prefix() + "f");
    fs::create_directories(dir);
    fs::path cfg = dir / "cfg.json";
    write_file(cfg, std::string(R"({"agents":[)") + minimal_agent("a") + R"(],"coordinator":{}})");

    SwarmPaths p{cfg.string(), ""};
    assert(agent_name_in_persisted_roster(p, "a"));

    // Simulate external process appending an agent (cache/mtime path must pick up change).
    write_file(cfg, std::string(R"({"agents":[)") + minimal_agent("a") + "," + minimal_agent("fresh") +
                               R"(],"coordinator":{}})");
    assert(agent_name_in_persisted_roster(p, "fresh"));

    fs::remove_all(dir);
}

int main() {
    test_roster_membership_single_file();
    test_roster_prefers_source_path();
    test_persist_prompt_roundtrip();
    test_dual_path_mirror_prompt();
    test_persist_tokens_source_optional();
    test_external_edit_visible_after_mtime_change();
    std::cout << "swarm_config_store_test: all checks passed\n";
    return 0;
}
