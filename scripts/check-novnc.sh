#!/bin/bash
# Health check: verifies noVNC is reachable through the cloudflared tunnel.
# Exit codes:
#   0 = noVNC is reachable AND basic_auth is enforced
#   1 = network/DNS error reaching the tunnel URL
#   2 = basic_auth is DISABLED (no-creds probe got 200 = security regression)
#   3 = noVNC route is missing (HTTP 404)
#   4 = noVNC upstream is broken (HTTP 502/503/504)
#
# Usage:
#   ./check-novnc.sh                            # uses NOVNC_URL env, or current-tunnel-url.txt, or default
#   NOVNC_URL=https://x.trycloudflare.com ./check-novnc.sh
#   ./check-novnc.sh -u user -p pass            # custom creds
#
# URL resolution order:
#   1. $NOVNC_URL env var
#   2. /opt/bing/current-tunnel-url.txt (or $TUNNEL_URL_FILE)
#   3. hardcoded default (cups-priced-lauderdale-exchanges.trycloudflare.com)
#
# Cron (every 5 min):
#   */5 * * * * /opt/bing/scripts/check-novnc.sh || /usr/local/bin/alert-noVNC-down

set -euo pipefail

USER="${NOVNC_USER:-admin}"
PASS="${NOVNC_PASS:-novnc}"
TIMEOUT=10
PATH_CHECK="/novnc/vnc_lite.html"
TUNNEL_URL_FILE="${TUNNEL_URL_FILE:-/opt/bing/current-tunnel-url.txt}"

# Resolve URL
URL="${NOVNC_URL:-}"
if [ -z "${URL}" ] && [ -s "${TUNNEL_URL_FILE}" ]; then
    # Only use the file if it's non-empty (guards against half-written files from
    # a tunnel sync that crashed mid-write).
    URL="$(tr -d '\r\n[:space:]' < "${TUNNEL_URL_FILE}")"
fi
URL="${URL:-https://cups-priced-lauderdale-exchanges.trycloudflare.com}"

echo "Checking: ${URL}${PATH_CHECK} (user=${USER})"

status=$(curl -sk -o /dev/null -w '%{http_code}' \
    --max-time "${TIMEOUT}" \
    -u "${USER}:${PASS}" \
    "${URL}${PATH_CHECK}" 2>/dev/null) || {
    echo "✗ Network/DNS error reaching ${URL}" >&2
    exit 1
}

# Also do a no-creds check: a 401 there proves the route is up and basic_auth is enforced.
no_creds_status=$(curl -sk -o /dev/null -w '%{http_code}' \
    --max-time "${TIMEOUT}" \
    "${URL}${PATH_CHECK}" 2>/dev/null) || no_creds_status=""

case "${status}" in
    200)
        # Explicit assertion: a 401 from the no-creds probe PROVES basic_auth is enforced.
        # A 200 from the no-creds probe would mean auth is broken (the route is up but
        # anyone can access it). We WARN but don't fail — the service is still up, but
        # the security control is missing.
        if [ "${no_creds_status}" = "401" ]; then
            echo "✓ noVNC is healthy (200 with creds, 401 without = auth enforced)"
            exit 0
        else
            echo "✓ noVNC is reachable (HTTP 200)" >&2
            echo "✗ but basic_auth appears DISABLED — no-creds probe got ${no_creds_status:-no-response} (expected 401)" >&2
            echo "  Check that the basic_auth { import /data/novnc-auth.txt } block is in infra/oracle/Caddyfile" >&2
            echo "  and that the auth file exists in the bing-caddy-1 container." >&2
            exit 2  # Treat disabled auth as a failure, not a warning — it's a security regression.
        fi
        ;;
    401)
        echo "✗ noVNC credentials were rejected (HTTP 401)" >&2
        echo "  Check that NOVNC_USER / NOVNC_PASS match /data/novnc-auth.txt in the container" >&2
        exit 2
        ;;
    403)
        echo "✗ noVNC access is forbidden (HTTP 403)" >&2
        exit 4  # 403 = upstream is rejecting our requests (distinct from 502/503/504)
        ;;
    404)
        echo "✗ noVNC route is MISSING on the tunnel (HTTP 404)" >&2
        echo "  Check infra/oracle/Caddyfile for the /novnc/* handle_path block" >&2
        exit 3
        ;;
    502|503|504)
        echo "✗ noVNC upstream is broken (HTTP ${status})" >&2
        echo "  websockify on the docker host (port 6080) may be down" >&2
        exit 4
        ;;
    *)
        echo "✗ noVNC returned unexpected status ${status}" >&2
        exit 2
        ;;
esac
