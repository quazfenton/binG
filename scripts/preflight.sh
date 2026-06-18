#!/usr/bin/env bash
# /opt/bing/scripts/preflight.sh — ARCH-001 Flag 3 vendor-API drift gate.
#
# Surfaces vendor-API drift (between installed node_modules and pinned
# snapshots under scripts/vendor-api-snapshots/) as a CI break. Exits non-zero
# when drift is detected so the next `git status` shows a clean no-pass.
#
# Trapdoors (env-vars):
#   PREFLIGHT_INCLUDE_ENV=1   also run the env-completeness sibling check
#                              (default: vendor-drift only; faster for CI).
#   PREFLIGHT_WARN_ONLY=1     print findings but exit 0 (advisory mode;
#                              useful for hotfixing a vendor bump in flight).
#
# Exit codes mirror the underlying drift script: 0 = pass, 1 = drift/missing,
# 2 = misconfiguration.
#
# Usage:
#   bash scripts/preflight.sh                                       # default (vendor-only)
#   PREFLIGHT_INCLUDE_ENV=1 bash scripts/preflight.sh                # also env-completeness
#   PREFLIGHT_WARN_ONLY=1 bash scripts/preflight.sh                  # advisory mode (exit 0)
#   pnpm check:vendor-drift --check=vendor                            # the bare script call
#
# Invocation contract:
#   The script intentionally does NOT have its executable bit set (`chmod +x`
#   deferred — see ARCH-001 Flag 3 followups). Always invoke via either:
#     (a) `bash scripts/preflight.sh` (literal), or
#     (b) `pnpm preflight` (uses the bash wrapper from package.json).
#   Direct `./scripts/preflight.sh` will fail with Permission denied — this is
#   intentional, not a defect.

set -euo pipefail
cd "$(dirname "$0")/.."

FLAGS="--check=vendor"
if [[ "${PREFLIGHT_INCLUDE_ENV:-0}" == "1" ]]; then
  FLAGS="--check=all"
fi
WARN_ONLY=""
if [[ "${PREFLIGHT_WARN_ONLY:-0}" == "1" ]]; then
  WARN_ONLY="--warn-only"
fi

echo "==> Running Preflight Checks ${FLAGS} ${WARN_ONLY}"

# `pnpm` propagates our exit code, but `set -e` would short-circuit on any
# non-zero return before we get to the final banner. Capture explicitly.
# Variables are quoted to defend against future trapdoors that expand to
# multi-token values (today FLAGS / WARN_ONLY are always single-token, but
# quoting future-proofs against IFS-injection drift).
set +e
pnpm check:vendor-drift "${FLAGS}" "${WARN_ONLY:-}"
RC=$?
set -e

if [ "${RC}" -eq 0 ]; then
  echo "==> Preflight PASS"
  exit 0
fi
echo "==> Preflight FAIL (drift detected; rc=${RC})" >&2
echo "    hint: pnpm check:vendor-drift --check=vendor --update   (regenerate snapshots)" >&2
echo "    hint: PREFLIGHT_WARN_ONLY=1 bash scripts/preflight.sh  (advisory only)" >&2
exit "${RC}"
