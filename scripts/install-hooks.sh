#!/bin/bash
# Installs the git pre-commit hook for the bing repo. Idempotent.
# Re-run after any `git clone` or if the hook is missing.
#
# Usage: scripts/install-hooks.sh
#   (run from anywhere; resolves the repo root from $0)

set -euo pipefail

# Resolve repo root from this script's path
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOK_SRC="${SCRIPT_DIR}/git-hooks/pre-commit"
HOOK_DST="${REPO_ROOT}/.git/hooks/pre-commit"

if [ ! -f "${HOOK_SRC}" ]; then
    echo "ERROR: hook source not found: ${HOOK_SRC}" >&2
    exit 1
fi

if [ -e "${HOOK_DST}" ] && [ ! -L "${HOOK_DST}" ]; then
    echo "Note: ${HOOK_DST} already exists and is not a symlink. Backing up to ${HOOK_DST}.bak"
    mv "${HOOK_DST}" "${HOOK_DST}.bak"
elif [ -L "${HOOK_DST}" ]; then
    # Stale symlink — remove it so the new ln -sf replaces it cleanly.
    echo "Note: removing stale symlink ${HOOK_DST} -> $(readlink "${HOOK_DST}")"
    rm "${HOOK_DST}"
fi

ln -sf ../../scripts/git-hooks/pre-commit "${HOOK_DST}"
echo "✓ Installed pre-commit hook: ${HOOK_DST} -> ${HOOK_SRC}"
echo "  Test:  bash -n .git/hooks/pre-commit && echo OK"
