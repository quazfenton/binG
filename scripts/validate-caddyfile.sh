#!/bin/bash
# Validates a Caddyfile by running caddy validate inside a running Caddy container.
#
# Exit codes:
#   0 = Caddyfile is valid (parse + semantic checks passed)
#   1 = usage / input error (file missing, empty, or unreadable)
#   2 = Caddyfile is invalid (parse or semantic error in the file)
#   3 = container is missing or not running
#
# Usage:
#   ./validate-caddyfile.sh                        # validate the default Caddyfile
#   ./validate-caddyfile.sh path/to/Caddyfile      # validate an arbitrary file
#   CADDY_CONTAINER=other-container ./validate-caddyfile.sh
#
# Pre-commit hook (add to bing repo's .git/hooks/pre-commit):
#
#   if git diff --cached --name-only | grep -q 'infra/oracle/Caddyfile$'; then
#       /opt/bing/scripts/validate-caddyfile.sh || {
#           echo "Caddyfile validation FAILED — commit blocked" >&2
#           exit 1
#       }
#   fi
#
# CI (add to .github/workflows/ci.yml):
#
#   - name: Validate Caddyfile
#     run: ./scripts/validate-caddyfile.sh
#     if: hashFiles('infra/oracle/Caddyfile')

set -euo pipefail

FILE="${1:-/opt/bing/infra/oracle/Caddyfile}"
CONTAINER="${CADDY_CONTAINER:-bing-caddy-1}"
TMP_REMOTE="/tmp/caddyfile-validate-$$"
STDERR_FILE="$(mktemp)"

# Cleanup the staged file inside the container AND our local stderr file on any
# exit (success or failure). The PID (`$$`) makes the container path unique per
# invocation so concurrent runs don't collide. The cleanup is wrapped in
# `timeout ... || true` so a dead/stuck container can't mask the real exit code.
cleanup() {
    rm -f "${STDERR_FILE}" 2>/dev/null || true
    timeout 5 docker exec "${CONTAINER}" rm -f "${TMP_REMOTE}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Validate inputs up front so failures are loud and clear, not buried in a
# confusing docker error further down.
if [ ! -f "${FILE}" ]; then
    echo "✗ File not found: ${FILE}" >&2
    exit 1
fi

if [ ! -s "${FILE}" ]; then
    echo "✗ File is empty: ${FILE}" >&2
    exit 1
fi

# Pre-flight: container must exist AND be running, otherwise docker cp / exec
# produce confusing errors.
if ! docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -q true; then
    echo "✗ Container not found or not running: ${CONTAINER}" >&2
    echo "  Set CADDY_CONTAINER env var to override (default: bing-caddy-1)" >&2
    exit 3
fi

echo "Validating: ${FILE} (via container: ${CONTAINER})"

# Stage the file in the container's /tmp (always writable; /etc/caddy is
# read-only in this image, which is why we can't validate in-place).
if ! docker cp "${FILE}" "${CONTAINER}:${TMP_REMOTE}" >/dev/null 2>&1; then
    echo "✗ docker cp failed: ${FILE} -> ${CONTAINER}:${TMP_REMOTE}" >&2
    exit 1
fi

# caddy validate runs parse + semantic checks and exits non-zero on either kind
# of error, with no JSON noise on stdout. (caddy adapt would also succeed
# silently on partial parses since it just emits whatever JSON it could build.)
if docker exec "${CONTAINER}" caddy validate --config "${TMP_REMOTE}" --adapter caddyfile >/dev/null 2>"${STDERR_FILE}"; then
    echo "✓ Caddyfile is valid (parse + semantic checks passed)"
    exit 0
else
    echo "✗ Caddyfile is INVALID (parse or semantic error):" >&2
    # Caddy's error output is typically: a one-line (sometimes 2-3 line) human-readable
    # error followed by a JSON dump of whatever it managed to parse. Print up to 5 lines,
    # or the first line containing an error keyword, whichever surfaces more signal.
    { grep -m1 -iE 'error|parse|validate|adapt' "${STDERR_FILE}" 2>/dev/null || head -n 5 "${STDERR_FILE}"; } >&2 || true
    exit 2
fi
