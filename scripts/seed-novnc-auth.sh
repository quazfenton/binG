#!/bin/bash
# Regenerates /data/novnc-auth.txt inside the bing-caddy-1 container.
# The file is in a Docker volume (not in git), so this is a runtime operation.
#
# Usage:
#   scripts/seed-novnc-auth.sh                       # random 18-char password, printed once
#   scripts/seed-novnc-auth.sh admin mySecret123     # custom user + password
#   CADDY_CONTAINER=other ./seed-novnc-auth.sh       # different container
#
# Programmatic parsing (for rotation scripts / cron / CI):
#   The [env] lines are emitted on STDERR (not stdout) so the human-readable
#   banner stays clean for interactive use. Capture pattern:
#
#     scripts/seed-novnc-auth.sh 2>/tmp/novnc.env     # stderr -> file
#     grep '^\[env\]' /tmp/novnc.env | sed 's/^\[env\] //' > /tmp/novnc-clean.env
#     set -a; source /tmp/novnc-clean.env; set +a
#
#   The cron wrapper (check-novnc-cron.sh) uses its OWN whitelist-based
#   secrets file (secrets/novnc-credentials.txt) for ongoing operations, not
#   these [env] lines — use them only for one-shot rotations in scripts.

set -euo pipefail

CONTAINER="${CADDY_CONTAINER:-bing-caddy-1}"
USER="${1:-admin}"
# Default: random 18-char base64 password, printed once.
PASS="${2:-$(openssl rand -base64 18 2>/dev/null || head -c 18 /dev/urandom | base64)}"

echo "Generating bcrypt hash for '${USER}' (random password unless overridden)..."

# Use the container's htpasswd if available (glibc bcrypt guaranteed), else host htpasswd, else python bcrypt.
if docker exec "${CONTAINER}" sh -c 'which htpasswd' >/dev/null 2>&1; then
    # htpasswd -nbB outputs colon-separated; Caddy needs SPACE-separated.
    LINE=$(docker exec "${CONTAINER}" htpasswd -nbB "${USER}" "${PASS}" 2>&1)
    HASH=$(echo "${LINE}" | cut -d: -f2-)
elif which htpasswd >/dev/null 2>&1; then
    LINE=$(htpasswd -nbB "${USER}" "${PASS}" 2>&1)
    HASH=$(echo "${LINE}" | cut -d: -f2-)
elif python3 -c 'import bcrypt' 2>/dev/null; then
    HASH=$(python3 -c "import bcrypt; print(bcrypt.hashpw(b'${PASS}', bcrypt.gensalt(rounds=10)).decode())")
else
    echo "ERROR: no bcrypt tool found (need htpasswd in container, htpasswd on host, or python3 + bcrypt)" >&2
    exit 1
fi

# Caddy basic_auth expects: "username hash" (space-separated), one per line.
CADDY_LINE="${USER} ${HASH}"
printf '%s\n' "${CADDY_LINE}" | docker exec -i "${CONTAINER}" sh -c \
    'cat > /data/novnc-auth.txt && chmod 600 /data/novnc-auth.txt && echo "wrote /data/novnc-auth.txt:" && cat /data/novnc-auth.txt'

echo
echo "============================================================="
echo "  Username: ${USER}"
echo "  Password: ${PASS}"
echo "============================================================="
# Emit machine-readable env-var lines to STDERR (not stdout) so callers can:
#   scripts/seed-novnc-auth.sh 2>/tmp/novnc.env
#   set -a; source /tmp/novnc.env; set +a
# (stderr keeps the contract clean for callers, while stdout remains the
# human-readable banner for interactive users.)
echo "[env] NOVNC_USERNAME=${USER}" >&2
echo "[env] NOVNC_PASSWORD=${PASS}" >&2
echo "[env] NOVNC_HASH=${HASH}" >&2
echo "[env] NOVNC_CADDY_LINE=${CADDY_LINE}" >&2
echo "[env] NOVNC_TUNNEL_URL=${NOVNC_TUNNEL_URL:-}" >&2

echo "SAVE THIS PASSWORD NOW — it won't be shown again."
echo "Reloading Caddy to pick up the new auth file..."
# Capture the reload's exit code BEFORE the pipe to tail (the pipe's \$? would
# be tail's, not the reload's, so we need PIPESTATUS or an explicit capture).
set +e  # we want to handle the failure ourselves below
docker exec "${CONTAINER}" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -2
reload_rc=${PIPESTATUS[0]}
set -e
if [ "${reload_rc}" -eq 0 ]; then
    echo "✓ Caddy reloaded. The new password is now active."
else
    echo "✗ Caddy reload FAILED (exit ${reload_rc}). The auth file was written but Caddy is still using the old one." >&2
    echo "  Check the error above and re-run: docker exec ${CONTAINER} caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile" >&2
    exit 1
fi
