#include "rag_client_pg.h"
#include "rag_client.h"

#include <cstdio>
#include <cstring>
#include <iostream>

namespace rag {

namespace {

constexpr const char* kSearchSql =
    "SELECT id, source_path, chunk_idx, content, "
    "       embedding <=> $1::vector AS distance "
    "  FROM chunks "
    " ORDER BY embedding <=> $1::vector "
    " LIMIT $2";

}  // namespace

RagPgConn& rag_pg_conn() {
    static RagPgConn c;
    return c;
}

bool rag_pg_ensure_open(RagPgConn& c, const std::string& dsn) {
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

std::vector<Hit> rag_pg_search(RagPgConn& c, const Settings& s,
    const std::vector<double>& emb) {
    std::vector<Hit> hits;
    std::string lit = vec_literal(emb);
    std::string k   = std::to_string(s.top_k);

    if (!rag_pg_ensure_open(c, s.dsn)) return hits;

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
        if (h.distance <= (1.0 - s.min_score)) hits.push_back(std::move(h));
    }
    PQclear(res);
    return hits;
}

void rag_pg_shutdown(RagPgConn& c) {
    if (c.pg) { PQfinish(c.pg); c.pg = nullptr; c.current_dsn.clear(); }
}

}  // namespace rag
