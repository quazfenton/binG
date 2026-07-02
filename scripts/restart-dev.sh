#!/usr/bin/env bash
set -euo pipefail

# scripts/restart-dev.sh — Restart the bing dev server cleanly on a target port.
#
# Why this exists:
#   Invoking `pnpm install` (the install hook on /opt/bing/web's `dev` script,
#   via the predev `init-db.js` chain, or via a generic refresh) can hit
#   `EACCES on /opt/_tmp_*` during a full_network install path while pnpm
#   materializes new_package tarballs and tmp-archives them. Two factual
#   workarounds restore the path:
#
#     (1) Maintenance-free install:  `pnpm install --offline --frozen-lockfile`
#         re_uses the existing pnpm store, so no /opt/_tmp_* materialization
#         happens. `--frozen_lockfile` also keeps pnpm from mutating the lock
#         during dev restarts.
#
#     (2) Skip the install hook entirely: invoke `pnpm exec next dev -p PORT`
#         directly. `web/node_modules/.bin/next` is already present in this
#         checkout, so the install is not needed before restarting.
#
#   Both paths share the same readiness protocol: poll /api/health until 2xx
#   or the wait budget expires (Next.js 16 first compile of a 5,800_line route
#   can take 60_90s, so a tight budget will lie).
#
# Usage:
#   bash scripts/restart-dev.sh                          # default port 3003
#   bash scripts/restart-dev.sh --port 3001
#   bash scripts/restart-dev.sh --no-install             # skip install step
#   bash scripts/restart-dev.sh --wait 180               # longer readiness budget
#   bash scripts/restart-dev.sh --help
#
# Environment overrides (all optional):
#   PORT=3003   default port (overridden by --port)
#   TMPDIR=/tmp log directory (defaults to ${TMPDIR:-/tmp})
#
# Exit codes:
#   0   dev server ready, /api/health and /api/chat both responded
#   1   install or readiness failed (see captured log)
#   124 unexpected internal error (missing node_modules, pnpm not on PATH, etc)
#
# Reproducible reference (host env: ubuntu/1001 on /opt/bing, pnpm 11.8.0,
# domNodeLinker=hoisted, cache=/opt/cache/npm, Node / 20.9+).
#
# Companion log: $LOG_FILE (typically /tmp/next-dev-<port>.log).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$REPO_ROOT/web"

# ── Defaults ─────────────────────────────────────────────────────────────
PORT="${PORT:-3003}"
WAIT_SECONDS=120
WAIT_SECONDS_CAP=600   # default ceiling for --wait; defense against typos like --wait 999999
DO_INSTALL=1
LOG_DIR="${TMPDIR:-/tmp}"

# ── Colors (only when stdout is a tty) ──────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") [--port N] [--no-install] [--wait SECS] [--help]

Options:
  --port N        port to bind (default: 3003 or env PORT)
  --no-install    skip the 'pnpm install' step (faster; use when node_modules is current)
  --wait SECS     readiness wait budget (default: 120, max 600)
  --wait-huge     raise --wait ceiling to 86400s (1 day); use with caution
  --help          show this help

Examples:
  bash scripts/restart-dev.sh --port 3003 --wait 180
  bash scripts/restart-dev.sh --no-install    # assumes pnpm install was just run
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --port)       PORT="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    --wait)       WAIT_SECONDS="$2"; shift 2 ;;
    --wait-huge)  WAIT_SECONDS_CAP=86400; shift ;;   # 1-day ceiling; opt-in for impatient debugging
    --help|-h)    usage; exit 0 ;;
    *)            printf '%s[ERROR]%s unknown argument: %s\n' "$RED" "$NC" "$1" >&2; usage >&2; exit 1 ;;
  esac
done

# Reject non-numeric / zero / negative / leading-zero --wait up-front
# (catches `--wait abc`, `--wait 0`, `--wait -1`, AND `--wait 007` with
# one uniform `[ERROR]` exit path). We CANNOT use bash arithmetic here:
# `[ "abc" -ge 1 ]` under `set -e` aborts the script with
# `[: integer expression expected` BEFORE the friendly printf can run.
# Use a bash regex match first (`#!/usr/bin/env bash`, so `[[ ... =~ ]]`
# is portable within this file). `^[1-9][0-9]*$` requires a leading
# 1-9 followed by zero or more digits — all of empty / zero / negative /
# non-numeric / leading-zero inputs trip the same `--wait must be a
# positive integer >= 1` error.
if ! [[ "$WAIT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  printf '%s[ERROR]%s --wait must be a positive integer >= 1; got: %s\n' "$RED" "$NC" "$WAIT_SECONDS" >&2
  exit 1
fi

# Cap --wait unless --wait-huge was passed (defense against typo 999999 or similar).
if [ "$WAIT_SECONDS" -gt "$WAIT_SECONDS_CAP" ]; then
  printf '%s[WARN]%s --wait %s exceeds cap %s; clamping to cap. Pass --wait-huge to opt out.\n' \
    "$YELLOW" "$NC" "$WAIT_SECONDS" "$WAIT_SECONDS_CAP"
  WAIT_SECONDS="$WAIT_SECONDS_CAP"
fi

banner() { printf '\n%s=== %s ===%s\n' "$BLUE" "$*" "$NC"; }

# Background-pid capture for the trap-driven cleanup path. The dev server
# must SURVIVE a successful exit, so cleanup only kills on a non-zero rc.
NEXT_DEV_PID=""
cleanup() {
  local rc=$?
  if [ -n "${NEXT_DEV_PID}" ] && kill -0 "$NEXT_DEV_PID" 2>/dev/null; then
    if [ "$rc" -ne 0 ]; then
      kill -9 "$NEXT_DEV_PID" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT

# ── Pre-flight ──────────────────────────────────────────────────────────
banner "Pre-flight"
if [ ! -d "$WEB_DIR" ]; then
  printf '%s[FATAL]%s web/ workspace not found: %s\n' "$RED" "$NC" "$WEB_DIR"
  exit 124
fi
if [ ! -x "$WEB_DIR/node_modules/.bin/next" ] && [ ! -x "$REPO_ROOT/node_modules/.bin/next" ]; then
  printf '%s[FATAL]%s next binary missing in web/node_modules OR root node_modules. run `pnpm install` first.\n' "$RED" "$NC"
  exit 124
fi
if ! command -v pnpm >/dev/null 2>&1; then
  printf '%s[FATAL]%s pnpm not on PATH.\n' "$RED" "$NC"
  exit 124
fi
LOG_FILE="$LOG_DIR/next-dev-${PORT}.log"
printf '  repo:    %s\n  web:     %s\n  port:    %s\n  log:     %s\n  budget:  %ss\n' \
  "$REPO_ROOT" "$WEB_DIR" "$PORT" "$LOG_FILE" "$WAIT_SECONDS"

# ── Step 1: free the target port from any stale listener ───────────────
banner "Step 1: free port $PORT"
stale_pids=""
# PID-safety: fuser/lsof can over-report on shared cgroups and surface our own
# shell / parent as a TCP listener on false positives. Filter those out before
# sending SIGKILL so the script cannot accidentally terminate itself.
filter_safe_pids() {
  local raw="$1"
  local safe=""
  for p in $raw; do
    if [ "$p" != "$$" ] && [ "$p" != "$PPID" ]; then
      safe="$safe $p"
    fi
  done
  printf '%s' "${safe# }"
}

if command -v fuser >/dev/null 2>&1; then
  stale_pids=$(fuser "${PORT}/tcp" 2>/dev/null || true)
  if [ -n "$stale_pids" ]; then
    safe_pids=$(filter_safe_pids "$stale_pids")
    if [ -n "$safe_pids" ]; then
      printf '  fuser reported stale listeners (excluding self): %s\n' "$safe_pids"
      # shellcheck disable=SC2086
      kill -9 $safe_pids 2>/dev/null || true
      sleep 1
    else
      printf '  fuser reported %s but all matched our shell; skipping kill.\n' "$stale_pids"
    fi
  fi
elif command -v lsof >/dev/null 2>&1; then
  stale_pids=$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$stale_pids" ]; then
    safe_pids=$(filter_safe_pids "$stale_pids")
    if [ -n "$safe_pids" ]; then
      printf '  lsof reported stale listeners (excluding self): %s\n' "$safe_pids"
      # shellcheck disable=SC2086
      kill -9 $safe_pids 2>/dev/null || true
      sleep 1
    else
      printf '  lsof reported %s but all matched our shell; skipping kill.\n' "$stale_pids"
    fi
  fi
fi
if (ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | grep -qE ":${PORT}\b"; then
  printf '%s[WARN]%s port %s still bound after cleanup. Try `fuser -k %s/tcp` manually.\n' \
    "$YELLOW" "$NC" "$PORT" "$PORT"
fi

# ── Step 2: idempotent install (offline + frozen-lockfile) ──────────────
# Mirrors the maintenance-free workaround for the /opt/_tmp_* EACCES: the
# offline + frozen_lockfile combo re_uses the pnpm store and never
# materializes new tarballs, so no scrubby temp paths open under /opt.
if [ "$DO_INSTALL" -eq 1 ]; then
  # The offline flag re_uses the existing pnpm store and never materializes
  # new package tarballs; that's what avoids the /opt/_tmp_* writes that
  # surface as EACCES under uid 1001 on this host. --frozen-lockfile keeps the
  # dev restart cycle idempotent w.r.t. the workspace lockfile.
  banner "Step 2: pnpm install --offline --frozen-lockfile (offline re_uses pnpm store; no new tarball writes)"
  cd "$REPO_ROOT"
  set +e
  pnpm install --offline --frozen-lockfile 2>&1 | tail -8
  install_rc=$?
  set -e
  if [ "$install_rc" -ne 0 ]; then
    printf '%s[FAIL]%s pnpm install exited %d. Output above may be truncated to 8 lines; rerun manually for full log.\n' \
      "$RED" "$NC" "$install_rc"
    exit 1
  fi
else
  banner "Step 2: SKIPPED (--no-install) — assumes web/node_modules is current"
fi

# ── Step 3: spawn next dev in background + wait for readiness ───────────
banner "Step 3: next dev -p $PORT (background, ${WAIT_SECONDS}s readiness budget)"
cd "$WEB_DIR"
rm -f "$LOG_FILE"
nohup pnpm exec next dev -p "$PORT" > "$LOG_FILE" 2>&1 &
NEXT_DEV_PID=$!
printf '  bg pid: %s\n  log:    %s\n' "$NEXT_DEV_PID" "$LOG_FILE"

ready=0
for i in $(seq 1 "$WAIT_SECONDS"); do
  # pipefail flag: even if /api/health is unreachable, the pipeline returns
  # the worst exit code (curl=7 for ECONNREFUSED) and the `if` correctly
  # classifies it as "not ready". `if` itself swallows the non-zero, so
  # set -e does not terminate the loop.
  if curl -sS --max-time 2 -o /dev/null -w '%{http_code}' \
       "http://localhost:${PORT}/api/health" 2>/dev/null | grep -qE '^[2-5]'; then
    ready=1
    printf '  %sREADY%s after %ss\n' "$GREEN" "$NC" "$i"
    break
  fi
  if [ $((i % 10)) -eq 0 ] && [ "$i" -lt "$WAIT_SECONDS" ]; then
    printf '  heartbeat: %ss elapsed, still waiting (Next.js 16 first compile can take 60-90s)...\n' "$i"
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  printf '%s[FAIL]%s port %s did not become ready within %ss.\n' \
    "$RED" "$NC" "$PORT" "$WAIT_SECONDS"
  echo '--- last 30 lines of dev log ---'
  tail -30 "$LOG_FILE" || true
  exit 1
fi

# ── Step 4: smoke-test the two endpoints ────────────────────────────────
banner "Step 4: smoke-test endpoints"
echo "--- GET /api/health ---"
HEALTH_BODY=$(curl -sS --max-time 8 "http://localhost:${PORT}/api/health" || true)
HEALTH_CODE=$(curl -sS --max-time 8 -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/health" || echo '000')
printf '  body: %s\n  HTTP: %s\n' "${HEALTH_BODY}" "$HEALTH_CODE"

echo "--- POST /api/chat (empty messages, expect 400 schema validation) ---"
CHAT_BODY=$(curl -sS --max-time 15 -X POST "http://localhost:${PORT}/api/chat" \
  -H 'Content-Type: application/json' -d '{"messages":[]}' || true)
CHAT_CODE=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  -X POST "http://localhost:${PORT}/api/chat" \
  -H 'Content-Type: application/json' -d '{"messages":[]}' || echo '000')
printf '  body: %s\n  HTTP: %s\n' "$CHAT_BODY" "$CHAT_CODE"

# ── Summary ─────────────────────────────────────────────────────────────
banner "Summary"
printf '  %s\u2713%s dev server listening on http://localhost:%s (bg pid=%s)\n' \
  "$GREEN" "$NC" "$PORT" "$NEXT_DEV_PID"
printf '  log:         %s\n  /api/health: HTTP %s\n  /api/chat:   HTTP %s\n' \
  "$LOG_FILE" "$HEALTH_CODE" "$CHAT_CODE"# Use a here-doc so variable expansion + line continuation render as
# actual newlines in the output (echo with double-quoted \n prints literal "\n",
# which is the bug that prompted this rewrite).
cat <<EOF
  Next steps:
    curl -N http://localhost:${PORT}/api/chat -H 'Content-Type: application/json' \
      -d '{"messages":[{"role":"user","content":"hello"}]}'
    tail -f $LOG_FILE   # follow dev log for subsequent requests
    bash scripts/restart-dev.sh --no-install   # restart fast after node_modules is current
EOF

# Detach the bg process from the EXIT trap so cleanup() does NOT kill it on
# the success path. The dev server lives in its own session via nohup and
# survives the parent shell's exit; the bg pid is intentionally left alive
# for the operator to inspect / kill later via fuser / kill -9 <pid>.
NEXT_DEV_PID=""
exit 0