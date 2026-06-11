#!/bin/bash
# Cron wrapper for check-novnc.sh. Whitelist-sources the secrets file and
# runs the health check, logging to logs/check-novnc.log and alerting via
# syslog if the service is degraded.
#
# Cron entry (5-min interval):
#   */5 * * * * /opt/bing/scripts/check-novnc-cron.sh
#
# Requires bash 4.2+ (uses process substitution `< <(...)` and parameter
# expansion with character classes `${var%[[:space:]]}`, both bash-specific
# and not POSIX sh).

set -uo pipefail
# Note: we use PIPESTATUS[0] to capture the wrapped script's exit code instead
# of relying on `set -o pipefail` to abort, because we want to react to
# non-zero exits (alert via logger), not abort.

# Concurrent-run protection: if the previous cron tick is still running (slow
# tunnel, hung check-novnc.sh), drop this tick with a logger note. The next
# tick (5 min later) will retry. Prevents log/file races.
LOCK="/var/lock/check-novnc.lock"
if command -v flock >/dev/null 2>&1; then
    exec 9>"${LOCK}"
    if ! flock -n 9; then
        /usr/bin/logger -t noVNC "check-novnc-cron: previous tick still running, dropping this tick"
        exit 0
    fi
fi

SECRETS="${NOVNC_SECRETS_FILE:-/opt/bing/secrets/novnc-credentials.txt}"
LOG="${NOVNC_CRON_LOG:-/opt/bing/logs/check-novnc.log}"
SCRIPT="/opt/bing/scripts/check-novnc.sh"

# Shebang guard: this script requires bash for process substitution.
if [ -z "${BASH_VERSION:-}" ]; then
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] FATAL: check-novnc-cron.sh requires bash (BASH_VERSION unset)" | tee -a "${LOG}" >&2
    exit 1
fi

if [ ! -f "${SECRETS}" ]; then
    msg="secrets file not found: ${SECRETS}"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] FATAL: ${msg}" | tee -a "${LOG}" >&2
    /usr/bin/logger -t noVNC "${msg}"
    exit 1
fi

# Source only the variables we want (whitelist, not `set -a; source` which
# would export every var including future comment/timestamp lines).
#
# CRITICAL: use process substitution (`< <(grep ...)`) instead of piping into
# `while` — pipes run the right-hand side in a SUBSHELL, so `export` calls
# are silently lost. Process substitution runs in the parent shell.
#
# Also strip CR (\r) from each line in case the file was edited on Windows or
# came from a samba share, AND strip trailing whitespace (which would otherwise
# pollute the env var value).
#
# ASSUMPTION: the secrets file is rewritten only by scripts/seed-novnc-auth.sh
# (hand-rotation), which rewrites it atomically (write-to-temp + mv). The
# `grep`+`read` race (where the file is rewritten between the grep and the
# read loop) is therefore not a real risk. If a future contributor starts
# rewriting the file in place, switch to a single-pass read of the file.
while IFS='=' read -r key value; do
    # Strip CR and trailing whitespace
    key="${key//$'\r'/}"
    value="${value//$'\r'/}"
    # Strip trailing whitespace from value (sed-style: only spaces/tabs at the end)
    value="${value%[[:space:]]}"
    case "${key}" in
        USERNAME|PASSWORD|URL)
            # Map to the NOVNC_* names that check-novnc.sh expects.
            export "NOVNC_${key}"="${value}"
            ;;
        \#*|"")
            # Comment line or blank line — skip
            ;;
        *)
            # Unknown key — ignore (don't export, don't error)
            ;;
    esac
done < <(grep -E '^(USERNAME|PASSWORD|URL)=' "${SECRETS}" 2>/dev/null)

# Fail loud if the required keys aren't set. Otherwise a missing/empty secrets
# file silently demotes the cron to the default-password path, which then
# fails auth every 5 minutes for an unrelated-looking reason.
if [ -z "${NOVNC_USERNAME:-}" ] || [ -z "${NOVNC_PASSWORD:-}" ]; then
    msg="secrets file ${SECRETS} is missing required keys (USERNAME and/or PASSWORD empty)"
    echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] FATAL: ${msg}" | tee -a "${LOG}" >&2
    /usr/bin/logger -t noVNC "${msg}"
    exit 1
fi

# Run the health check, capture exit code, log + alert.
# (No pipe here on the script call, so we use PIPESTATUS[0] of the tee to get
# the script's exit code.)
# No pipe — direct file redirect (avoids PIPESTATUS defensive defaults entirely).
# Captures the script's exit code in `$?` directly.
"${SCRIPT}" >> "${LOG}" 2>&1
rc=$?

if [ "${rc}" -ne 0 ]; then
    /usr/bin/logger -t noVNC "check-novnc.sh exit ${rc} — see ${LOG}"
fi

# Cap the log at 1MB to prevent disk-fill over months of 5-min ticks.
# Cheap inline rotation: keep the last 1MB of the log.
if [ -f "${LOG}" ] && [ "$(stat -c %s "${LOG}" 2>/dev/null || stat -f %z "${LOG}" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    tail -c 1048576 "${LOG}" > "${LOG}.tmp" && mv "${LOG}.tmp" "${LOG}"
fi

exit "${rc}"
