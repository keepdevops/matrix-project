#pragma once

#include "rag_config.h"

#include <libpq-fe.h>

#include <mutex>
#include <string>
#include <vector>

namespace rag {

struct Hit;

struct RagPgConn {
    std::mutex mu;
    PGconn*    pg  = nullptr;
    std::string current_dsn;
};

RagPgConn& rag_pg_conn();
bool rag_pg_ensure_open(RagPgConn& c, const std::string& dsn);
std::vector<Hit> rag_pg_search(RagPgConn& c, const Settings& s,
    const std::vector<double>& emb);
void rag_pg_shutdown(RagPgConn& c);

}  // namespace rag
