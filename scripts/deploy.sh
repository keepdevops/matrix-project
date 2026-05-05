#!/usr/bin/env bash
# Deploy docs/ (the coficube.com splash) to Cloudflare Pages.
#
# Requirements:
#   - wrangler installed (`npm i -g wrangler` or use `npx wrangler` below)
#   - CLOUDFLARE_API_TOKEN exported in env (token needs Pages:Edit)
#   - CLOUDFLARE_ACCOUNT_ID exported in env
#
# Usage:
#   ./scripts/deploy.sh                     # deploy current docs/ to production
#   PAGES_PROJECT=coficube-splash ./scripts/deploy.sh
#   BRANCH=preview ./scripts/deploy.sh      # deploy as a preview branch

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="${ROOT}/docs"
PAGES_PROJECT="${PAGES_PROJECT:-coficube-splash}"
BRANCH="${BRANCH:-main}"

if [ ! -d "$DIR" ]; then
  echo "[deploy] error: $DIR not found" >&2
  exit 1
fi

if [ ! -f "$DIR/index.html" ]; then
  echo "[deploy] error: $DIR/index.html missing — nothing to deploy" >&2
  exit 1
fi

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required (Pages:Edit scope)}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"

VERSION=$(grep -oE 'open source · v[0-9]+\.[0-9]+\.[0-9]+' "$DIR/index.html" | head -1 | sed -E 's/.*v//' || echo "unknown")
echo "[deploy] project=$PAGES_PROJECT branch=$BRANCH version=$VERSION dir=$DIR"

WRANGLER="npx --yes wrangler@latest"
command -v wrangler >/dev/null 2>&1 && WRANGLER="wrangler"

$WRANGLER pages deploy "$DIR" \
  --project-name="$PAGES_PROJECT" \
  --branch="$BRANCH" \
  --commit-dirty=true

echo "[deploy] done — https://${PAGES_PROJECT}.pages.dev (or your custom domain) updated to v${VERSION}"
