#include "rag_client.h"
#include "rag_client_embed.h"
#include "rag_client_pg.h"

#include "rag_embed.h"

#include <libpq-fe.h>

#include <cstdio>
#include <iostream>
#include <sstream>

namespace rag {

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
    std::vector<double> emb;
    if (s.embedder == "hash") {
        emb = hash_embed(query);
    } else if (s.embedder == "mlx" || s.embedder == "bge") {
        emb = mlx_embed(s.embed_url, query);
        if (emb.empty()) return hits;
    } else {
        std::cerr << "❌ [rag] unknown embedder '" << s.embedder
                  << "'; supported: hash, mlx, bge" << std::endl;
        return hits;
    }

    RagPgConn& c = rag_pg_conn();
    std::lock_guard<std::mutex> lock(c.mu);
    return rag_pg_search(c, s, emb);
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
    RagPgConn& c = rag_pg_conn();
    std::lock_guard<std::mutex> lock(c.mu);
    if (!rag_pg_ensure_open(c, s.dsn)) {
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
    RagPgConn& c = rag_pg_conn();
    std::lock_guard<std::mutex> lock(c.mu);
    rag_pg_shutdown(c);
}

} // namespace rag
