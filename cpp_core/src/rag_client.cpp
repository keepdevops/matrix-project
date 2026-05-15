#include "rag_client.h"

#include "rag_embed.h"

#include <libpq-fe.h>

#include <cstdio>
#include <cstring>
#include <iostream>
#include <mutex>
#include <sstream>

namespace rag {

namespace {

constexpr const char* kSearchSql =
    "SELECT id, source_path, chunk_idx, content, "
    "       embedding <=> $1::vector AS distance "
    "  FROM chunks "
    " ORDER BY embedding <=> $1::vector "
    " LIMIT $2";

struct Conn {
    std::mutex mu;
    PGconn*    pg  = nullptr;
    std::string current_dsn;

    ~Conn() { if (pg) PQfinish(pg); }
};

Conn& conn_singleton() {
    static Conn c;
    return c;
}

bool ensure_open_locked(Conn& c, const std::string& dsn) {
    if (c.pg && PQstatus(c.pg) == CONNECTION_OK && c.current_dsn == dsn) {
        return true;
    }
    if (c.pg) { PQfinish(c.pg); c.pg = nullptr; }
    c.pg = PQconnectdb(dsn.c_str());
    c.current_dsn = dsn;
    if (PQstatus(c.pg) != CONNECTION_OK) {
        std::cerr << "❌ [rag] connect failed: "
                  << PQerrorMessage(c.pg) << std::endl;
        PQfinish(c.pg);
        c.pg = nullptr;
        return false;
    }
    return true;
}

} // namespace

std::string vec_literal(const std::vector<double>& v) {
    std::ostringstream os;
    os << '[';
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) os << ',';
        char buf[32];
        std::snprintf(buf, sizeof(buf), "%.6f", v[i]);
        os << buf;
    }
    os << ']';
    return os.str();
}

std::vector<Hit> retrieve(const Settings& s, const std::string& query) {
    std::vector<Hit> hits;
    if (!s.enabled) return hits;
    if (query.empty()) return hits;
    if (s.embedder != "hash") {
        std::cerr << "❌ [rag] embedder '" << s.embedder
                  << "' not implemented in coordinator; only 'hash' is wired."
                  << std::endl;
        return hits;
    }

    std::vector<double> emb = hash_embed(query);
    std::string lit = vec_literal(emb);
    std::string k   = std::to_string(s.top_k);

    Conn& c = conn_singleton();
    std::lock_guard<std::mutex> lock(c.mu);
    if (!ensure_open_locked(c, s.dsn)) return hits;

    const char* params[2] = { lit.c_str(), k.c_str() };
    PGresult* res = PQexecParams(
        c.pg, kSearchSql, 2, nullptr, params, nullptr, nullptr, /*text*/0);
    if (!res || PQresultStatus(res) != PGRES_TUPLES_OK) {
        std::cerr << "❌ [rag] search failed: "
                  << (res ? PQresultErrorMessage(res) : "no result")
                  << std::endl;
        if (res) PQclear(res);
        return hits;
    }
    int rows = PQntuples(res);
    hits.reserve(rows);
    for (int i = 0; i < rows; ++i) {
        Hit h;
        h.id          = std::strtoll(PQgetvalue(res, i, 0), nullptr, 10);
        h.source_path = PQgetvalue(res, i, 1);
        h.chunk_idx   = std::atoi(PQgetvalue(res, i, 2));
        h.content     = PQgetvalue(res, i, 3);
        h.distance    = std::strtod(PQgetvalue(res, i, 4), nullptr);
        if (h.distance <= s.min_score) hits.push_back(std::move(h));
    }
    PQclear(res);
    return hits;
}

std::string render_context_block(const std::vector<Hit>& hits) {
    if (hits.empty()) return {};
    std::ostringstream os;
    os << "<context source=\"rag\">\n";
    for (size_t i = 0; i < hits.size(); ++i) {
        os << "[#" << i << " " << hits[i].source_path
           << " chunk=" << hits[i].chunk_idx
           << " distance=" << hits[i].distance << "]\n"
           << hits[i].content << "\n";
    }
    os << "</context>\n\n";
    return os.str();
}

bool health_check(const Settings& s, std::string* error_out) {
    if (!s.enabled) {
        if (error_out) *error_out = "rag.enabled is false";
        return false;
    }
    Conn& c = conn_singleton();
    std::lock_guard<std::mutex> lock(c.mu);
    if (!ensure_open_locked(c, s.dsn)) {
        if (error_out) *error_out = "pgvector connect failed";
        return false;
    }
    PGresult* res = PQexec(c.pg, "SELECT 1");
    bool ok = res && PQresultStatus(res) == PGRES_TUPLES_OK;
    if (!ok) {
        std::string msg = res ? PQresultErrorMessage(res) : "no result";
        std::cerr << "❌ [rag] health probe failed: " << msg << std::endl;
        if (error_out) *error_out = msg;
    }
    if (res) PQclear(res);
    return ok;
}

void shutdown_for_test() {
    Conn& c = conn_singleton();
    std::lock_guard<std::mutex> lock(c.mu);
    if (c.pg) { PQfinish(c.pg); c.pg = nullptr; c.current_dsn.clear(); }
}

} // namespace rag
