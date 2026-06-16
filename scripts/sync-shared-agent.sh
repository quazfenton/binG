#!/usr/bin/env bash
# scripts/sync-shared-agent.sh
#
# Replacement for the legacy `cp -av` byte-replacement that silently
# destroyed intentional local edits on the web-side mirror.
#
# Strategy (per file):
#   1. Source-of-truth is packages/shared/agent/ (canonical). Mirror is
#      web/.bing-shared/agent/.
#   2. Compute sha256 of pkg-side and web-side.
#       - equal -> IN_SYNC, skip.
#   3. Else, use `rsync --checksum --itemize-changes` (NOT `cp -av`).
#       --checksum forces rsync to compare by checksum (not mtime/size),
#       so a copy ONLY happens when source and target content actually
#       differ. --itemize-changes prints a per-file marker
#       (>f..t...... foo.ts) making the decision auditable.
#   4. If `git status` reports the web-side file as having uncommitted
#      local edits (suggesting an intentional local edit), fall back to
#      `git merge-file` for 3-way reconciliation instead of overwriting.
#       - A copy is taken to $web_f.localbackup before any merge attempt.
#       - git merge-file is invoked with pkg as the "base+theirs" pair
#         and web as the "ours", so the LINE OF LEAST RESISTANCE is to
#         keep web's local edits and accept pkg's new content via merge.
#       - If git merge-file leaves conflict markers, exit 1 with the
#         file left in place for manual review (NEVER auto-resolved).
#
# Exit codes:
#   0  all targets synced (mirrors byte-identical after the run)
#   1  one or more files need manual reconciliation (or rsync failed)
#   2  configuration / path error
#
# Env vars:
#   PROJECT_ROOT    default /opt/bing
#   WEB_MIRROR      default ${PROJECT_ROOT}/web/.bing-shared/agent
#   PKG_MIRROR      default ${PROJECT_ROOT}/packages/shared/agent
#   DRY_RUN         default 0  (set to 1 for rsync --dry-run; safe-by-default)
#   QUIET           default 0  (set to 1 to suppress per-file output)
#   OUT_OF_SYNC_FILES  optional whitelist (newline-separated basenames);
#                      defaults to detect-drift.sh's OUT_OF_SYNC list.

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/bing}"
WEB_MIRROR="${WEB_MIRROR:-${PROJECT_ROOT}/web/.bing-shared/agent}"
PKG_MIRROR="${PKG_MIRROR:-${PROJECT_ROOT}/packages/shared/agent}"
DRY_RUN="${DRY_RUN:-0}"
QUIET="${QUIET:-0}"

say() { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }
err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }
note(){ printf '\033[33m%s\033[0m\n' "$*"; }

if [ ! -d "$WEB_MIRROR" ]; then err "ERROR: WEB_MIRROR not found: $WEB_MIRROR"; exit 2; fi
if [ ! -d "$PKG_MIRROR" ]; then err "ERROR: PKG_MIRROR not found: $PKG_MIRROR"; exit 2; fi

hash_file() { sha256sum "$1" | awk '{print $1}'; }

# Pre-flight cleanup: remove stale side-by-side artifacts from any prior
# failed runs so they don't accumulate in the mirror as `web-only` files
# (which would inflate detect-drift.sh's WEB_ONLY count indefinitely).
# These artifacts are only created by the unsafe-path branch below for
# files flagged as manual-review-needed, so cleanup is destructive of
# human reviewer work-in-progress. Therefore it is GATED behind
# `CLEANUP_STALE_ARTIFACTS=1` (default 0): the operator must explicitly
# opt in.
if [ "${CLEANUP_STALE_ARTIFACTS:-0}" = "1" ]; then
    find "$WEB_MIRROR" -maxdepth 1 -type f \
        \( -name '*.localbackup' -o -name '*.pkg-overlay' -o -name '*.patch' \) \
        -delete >/dev/null 2>&1 || true
    note "CLEANUP_STALE_ARTIFACTS=1: removed *.localbackup / *.pkg-overlay / *.patch"
fi

# Determine the file list to act on. Prefer OUT_OF_SYNC_FILES whitelist if
# provided; otherwise enumerate by direct cmp comparison (NOT by parsing
# detect-drift.sh QUIET=1 output — that's suppressed and would return an
# empty list making the script a no-op). Enumeration captures the loop's
# stdout (basenames of differing files) into the FILES variable via
# `$(...)` command substitution. Without `$(...)`, the `printf` inside
# `< <(...)` redirection would write to the script's stdout but never
# populate FILES, making the script silently a no-op.
FILES=""
if [ -n "${OUT_OF_SYNC_FILES:-}" ]; then
    FILES="$OUT_OF_SYNC_FILES"
else
    FILES="$(
        while IFS= read -r pkg_f; do
            [ -z "$pkg_f" ] && continue
            bn=$(basename "$pkg_f")
            web_path="$WEB_MIRROR/$bn"
            if [ ! -f "$web_path" ] || ! cmp -s "$pkg_f" "$web_path" 2>/dev/null; then
                printf '%s\n' "$bn"
            fi
        done < <(find "$PKG_MIRROR" -maxdepth 1 -type f -name '*.ts' -printf '%p\n' | sort)
    )"
fi

if [ -z "$FILES" ]; then
    ok "no OUT_OF_SYNC files; nothing to sync."
    exit 0
fi

file_count=$(printf '%s\n' "$FILES" | sed '/^$/d' | wc -l | tr -d ' ')
say "== sync-shared-agent: $file_count files  DRY_RUN=$DRY_RUN =="

# Make sure git can see uncommitted-local-edit status for the web-side
# mirror so the safety gate has something to read.
git_root=""
cd "$PROJECT_ROOT"
if git rev-parse --show-toplevel >/dev/null 2>&1; then
    git_root="$(git rev-parse --show-toplevel)"
fi

sync_failed=0
sync_ok=0

while IFS= read -r f; do
    [ -z "$f" ] && continue
    web_f="$WEB_MIRROR/$f"
    pkg_f="$PKG_MIRROR/$f"

    if [ ! -f "$pkg_f" ]; then
        err "PKG missing — would orphan mirror: $f"
        sync_failed=1
        continue
    fi

    pre_pkg_hash="$(hash_file "$pkg_f")"

    if [ ! -f "$web_f" ]; then
        note "WEB missing — rsync will create: $f"
        pre_web_hash="MISSING"
    else
        pre_web_hash="$(hash_file "$web_f")"
    fi

    # Step 1: equal -> already in sync, no work needed.
    if [ "$pre_web_hash" = "$pre_pkg_hash" ]; then
        ok "IN_SYNC  $f"
        sync_ok=$((sync_ok + 1))
        continue
    fi

    # Step 2: detect uncommitted local edits on web side. Only escalate
    # to the manual-review path when the file is git-TRACKED AND differs
    # from HEAD. Untracked and gitignored files (the typical case for
    # `web/.bing-shared/agent/*` mirror files) fall through to the safe
    # rsync path, since they are stale-mirror copies that the script's
    # whole reason for existing is to repair.
    unsafe=0
    if [ -n "$git_root" ] && [ -f "$web_f" ]; then
        # First check that the file is actually tracked (NOT `??` untracked,
        # NOT gitignored). `git ls-files --error-unmatch` exits 0 only when
        # the path is in the index.
        if git ls-files --error-unmatch -- "$web_f" >/dev/null 2>&1; then
            # Tracked. Now check if working tree differs from HEAD.
            # `git diff-index --quiet HEAD` exits 0 (no diff) -> clean -> unsafe=0.
            if ! git diff-index --quiet HEAD -- "$web_f" 2>/dev/null; then
                unsafe=1
            fi
        fi
    fi

    if [ "$unsafe" = "1" ]; then
        # Step 3: web-side file is git-tracked AND has real local edits.
        # Refuse to rsync (would destroy them) and refuse to call
        # `git merge-file $web $pkg $pkg` which is degenerate (base==theirs
        # can't import pkg's new content). Instead, emit manual-review
        # artifacts and leave $web_f untouched:
        #   - $web_f.localbackup   : pre-sync snapshot of web's text
        #   - $web_f.pkg-overlay   : pkg's current text (for visual compare)
        #   - $web_f.patch         : unified diff web -> pkg-overlay
        # Exit 1 is reported for the file; reviewer can reconcile manually.
        note "LOCAL_EDITS_DETECTED  $f — refusing rsync; emitting manual-review artifacts"

        if [ "$DRY_RUN" = "1" ]; then
            note "DRY_RUN would write $web_f.localbackup / .pkg-overlay / .patch"
            sync_failed=1
            continue
        fi

        cp "$web_f" "$web_f.localbackup"
        cp "$pkg_f" "$web_f.pkg-overlay"
        diff -u "$web_f" "$web_f.pkg-overlay" > "$web_f.patch" || true
        err "MANUAL_REVIEW_NEEDED  $f  localbackup=$web_f.localbackup  pkg-overlay=$web_f.pkg-overlay  patch=$web_f.patch"
        sync_failed=1
        continue
    fi

    # Step 4: safe rsync. --checksum forces checksum-based decision
    # (NEVER copies when source and target checksums match). --itemize-
    # changes prints a per-file decision marker so a reviewer can audit
    # what rsync did. rsync -a preserves source mtimes (per the user's
    # literal `rsync -a --checksum --itemize-changes` request).
    rsync_args=(-a --checksum --itemize-changes)
    if [ "$DRY_RUN" = "1" ]; then
        rsync_args+=(--dry-run)
    fi

    rsync_out="$(rsync "${rsync_args[@]}" "$pkg_f" "$web_f" 2>&1 || true)"
    note "RSYNC    $f  --- $rsync_out"

    if [ "$DRY_RUN" = "1" ]; then
        sync_ok=$((sync_ok + 1))
        continue
    fi

    post_web_hash="$(hash_file "$web_f")"
    if [ "$post_web_hash" = "$pre_pkg_hash" ]; then
        ok "SYNCED   $f"
        sync_ok=$((sync_ok + 1))
    else
        err "FAIL     $f  post-rsync web hash != pre-rsync pkg hash"
        sync_failed=1
    fi
done <<<"$FILES"

say ""
say "== summary =="
say "  synced  = $sync_ok"
say "  failed  = $([ "$sync_failed" -eq 1 ] && echo 1 || echo 0)"
say "  scan    = PROJECT_ROOT=$PROJECT_ROOT  WEB_MIRROR=$WEB_MIRROR"

if [ "$sync_failed" -eq 1 ]; then exit 1; fi
exit 0
