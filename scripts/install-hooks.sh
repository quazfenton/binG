#!/bin/bash
# Installs git hooks for the bing repo. Idempotent.
# Re-run after any `git clone` or if hooks are missing/outdated.
#
# Usage: scripts/install-hooks.sh
#   (run from anywhere; resolves the repo root from $0)
#
# Hooks installed (all as relative symlinks, so they survive repo moves):
#   pre-commit  -> scripts/git-hooks/pre-commit
#   pre-push    -> scripts/git-pre-push.sh
#   post-merge  -> scripts/git-hooks/post-merge  (auto-reinstalls hooks on pull)
#
# Symlinks mean the active .git/hooks/<name> *is* the canonical source — they
# can never drift apart by construction. The post-merge hook is a belt-and-
# suspenders: if anyone ever copies a hook to a real file (e.g. `git config
# core.hooksPath` to a non-symlinked dir), the next pull restores the symlink.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
HOOKS_DIR="${REPO_ROOT}/.git/hooks"

# Each entry: "<hook-name>:<source-path-relative-to-repo-root>"
HOOKS=(
    "pre-commit:scripts/git-hooks/pre-commit"
    "pre-push:scripts/git-pre-push.sh"
    "post-merge:scripts/git-hooks/post-merge"
)

install_hook() {
    local name="$1"
    local src_rel="$2"
    local src="${REPO_ROOT}/${src_rel}"
    local dst="${HOOKS_DIR}/${name}"
    local link_target="../../${src_rel}"

    if [ ! -f "${src}" ]; then
        echo "WARNING: hook source not found: ${src} (skipping ${name})" >&2
        return 0
    fi

    # Ensure the source itself is executable (the hook needs to run).
    chmod +x "${src}"

    # Already a correct symlink — nothing to do.
    if [ -L "${dst}" ]; then
        local current_target
        current_target="$(readlink "${dst}" 2>/dev/null || true)"
        if [ "${current_target}" = "${link_target}" ]; then
            echo "✓ ${name}: already up to date"
            return 0
        fi
        echo "Note: replacing stale symlink ${dst} -> ${current_target}"
        rm "${dst}"
    fi

    # A real file exists at the destination (e.g. installed manually) — back it up.
    if [ -e "${dst}" ]; then
        echo "Note: ${dst} already exists and is not a symlink. Backing up to ${dst}.bak"
        mv "${dst}" "${dst}.bak"
    fi

    ln -sf "${link_target}" "${dst}"
    echo "✓ Installed ${name}: ${dst} -> ${link_target}"
}

for entry in "${HOOKS[@]}"; do
    name="${entry%%:*}"
    src_rel="${entry#*:}"
    install_hook "${name}" "${src_rel}"
done

echo ""
echo "All hooks installed. Test: bash -n .git/hooks/pre-push && echo OK"
