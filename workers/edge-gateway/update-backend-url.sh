#!/usr/bin/env bash
# ============================================================
#  binG Edge Gateway — Broadcast BACKEND_URL update
# ============================================================
# Updates the runtime BACKEND_URL in the Cloudflare worker's KV by
# calling POST /admin/backend-url. Use this whenever the cloudflared
# tunnel URL changes (e.g., after a container restart).
#
# Usage:
#   ./update-backend-url.sh https://new-tunnel.trycloudflare.com
#   ./update-backend-url.sh --auto    # detects URL from `docker logs bing-cloudflared-1`
#
# Env vars / files:
#   ADMIN_TOKEN  — admin token (or read from .admin-token in this dir)
#   WORKER_URL   — worker public URL, e.g. https://shared-ingress.<acct>.workers.dev
#                  (or read from wrangler whoami / wrangler.toml-derived default)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Resolve admin token ───────────────────────────────────
if [ -z "${ADMIN_TOKEN:-}" ]; then
  if [ -f .admin-token ]; then
    ADMIN_TOKEN=$(tr -d '\n\r' < .admin-token)
  fi
fi
if [ -z "${ADMIN_TOKEN:-}" ]; then
  echo "❌ ADMIN_TOKEN not set. Export it or place it in $SCRIPT_DIR/.admin-token" >&2
  exit 1
fi

# ─── Resolve worker URL ────────────────────────────────────
if [ -z "${WORKER_URL:-}" ]; then
  if command -v npx >/dev/null 2>&1; then
    NAME=$(grep -E '^name[[:space:]]*=' wrangler.toml 2>/dev/null | head -1 | sed -E 's/^name[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/' || true)
    SUBDOMAIN=$(npx --no-install wrangler whoami 2>/dev/null | grep -oE '[a-z0-9-]+\.workers\.dev' | head -1 || true)
    if [ -n "${NAME:-}" ] && [ -n "${SUBDOMAIN:-}" ]; then
      WORKER_URL="https://${NAME}.${SUBDOMAIN%%.workers.dev}.workers.dev"
    fi
  fi
fi
if [ -z "${WORKER_URL:-}" ]; then
  echo "❌ WORKER_URL not set and could not auto-detect. Export WORKER_URL=https://..." >&2
  exit 1
fi

# ─── Resolve new backend URL ───────────────────────────────
NEW_URL="${1:-}"
if [ -z "$NEW_URL" ]; then
  echo "Usage: $0 <https://new-backend-url> | --auto" >&2
  exit 1
fi

if [ "$NEW_URL" = "--auto" ]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "❌ --auto requires docker on this host" >&2
    exit 1
  fi
  NEW_URL=$(docker logs bing-cloudflared-1 2>&1 \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | tail -1 || true)
  if [ -z "$NEW_URL" ]; then
    echo "❌ Could not detect tunnel URL from 'docker logs bing-cloudflared-1'" >&2
    exit 1
  fi
  echo "🔍 Auto-detected tunnel URL: $NEW_URL"
fi

if ! [[ "$NEW_URL" =~ ^https?://[^[:space:]/]+(/.*)?$ ]]; then
  echo "❌ Invalid URL: $NEW_URL" >&2
  exit 1
fi
NEW_URL="${NEW_URL%/}"

# ─── Broadcast ─────────────────────────────────────────────
echo "📡 POST ${WORKER_URL}/admin/backend-url"
echo "   url = $NEW_URL"

HTTP_RESPONSE=$(curl -sS -w '\n%{http_code}' \
  -X POST "${WORKER_URL%/}/admin/backend-url" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  --data "{\"url\":\"${NEW_URL}\"}" \
  --max-time 15)

HTTP_BODY=$(printf '%s' "$HTTP_RESPONSE" | sed '$d')
HTTP_CODE=$(printf '%s' "$HTTP_RESPONSE" | tail -n1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ BACKEND_URL updated"
  echo "   $HTTP_BODY"
  exit 0
else
  echo "❌ Update failed (HTTP $HTTP_CODE)" >&2
  echo "   $HTTP_BODY" >&2
  exit 1
fi
