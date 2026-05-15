#!/usr/bin/env bash
# Manage the RAG docker-compose stack (pgvector backing store for orchestration/rag).
#
# Usage:
#   scripts/rag-docker-compose.sh up        # start in background
#   scripts/rag-docker-compose.sh down      # stop and remove containers
#   scripts/rag-docker-compose.sh restart
#   scripts/rag-docker-compose.sh logs      # follow logs
#   scripts/rag-docker-compose.sh status    # ps + health
#   scripts/rag-docker-compose.sh psql      # open psql shell against matrix_rag
#   scripts/rag-docker-compose.sh wait      # block until pg_isready succeeds
#   scripts/rag-docker-compose.sh nuke      # down + delete the pgvector_data volume

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/docker/pgvector/docker-compose.yml"
SERVICE="pgvector"
DB_USER="${RAG_DB_USER:-matrix}"
DB_NAME="${RAG_DB_NAME:-matrix_rag}"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "error: compose file not found at $COMPOSE_FILE" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "error: neither 'docker compose' nor 'docker-compose' is installed" >&2
  exit 1
fi

dc() { "${DC[@]}" -f "$COMPOSE_FILE" "$@"; }

cmd="${1:-up}"
shift || true

case "$cmd" in
  up)
    dc up -d "$@"
    echo "pgvector is starting. RAG_DSN=postgresql://${DB_USER}:matrix@127.0.0.1:5433/${DB_NAME}"
    ;;
  down)
    dc down "$@"
    ;;
  restart)
    dc restart "$@"
    ;;
  logs)
    dc logs -f "$@"
    ;;
  status|ps)
    dc ps
    ;;
  wait)
    echo -n "waiting for pgvector"
    for _ in $(seq 1 60); do
      if dc exec -T "$SERVICE" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1; then
        echo " ready"; exit 0
      fi
      echo -n "."; sleep 1
    done
    echo " timeout" >&2; exit 1
    ;;
  psql)
    dc exec "$SERVICE" psql -U "$DB_USER" -d "$DB_NAME" "$@"
    ;;
  nuke)
    dc down -v
    ;;
  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}"
    exit 2
    ;;
esac
