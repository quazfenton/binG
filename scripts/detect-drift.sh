#!/usr/bin/env bash
# scripts/detect-drift.sh
#
# Drift detector for the web-side mirror vs the canonical packages-side
# source under @bing/shared/agent. Designed to fail CI when the mirror
# and the canonical source diverge on a byte level.
#
# Exit codes:
#   0  every common file is byte-identical AND no mirror-missing file
#   1  at least one OUT_OF_SYNC file detected
#   2  at least one file exists in only ONE mirror (mirror-missing)
#   3  configuration / path error
#
# Env vars (all optional):
#   PROJECT_ROOT   default /opt/bing
#   WEB_MIRROR     default ${PROJECT_ROOT}/web/.bing-shared/agent
#   PKG_MIRROR     default ${PROJECT_ROOT}/packages/shared/agent
#   DIFF_OUT_DIR   default /tmp/detect-drift-diffs (per-file .patch cached)
#   QUIET          set to 1 to suppress the per-file output (summary only)

set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/bing}"
WEB_MIRROR="${WEB_MIRROR:-${PROJECT_ROOT}/web/.bing-shared/agent}"
PKG_MIRROR="${PKG_MIRROR:-${PROJECT_ROOT}/packages/shared/agent}"
DIFF_OUT_DIR="${DIFF_OUT_DIR:-/tmp/detect-drift-diffs}"
QUIET="${QUIET:-0}"

mkdir -p "$DIFF_OUT_DIR"

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
bold()   { printf '\033[1m%s\033[0m'  "$1"; }
say()    { [ "$QUIET" = "1" ] || printf '%s\n' "$*"; }

if [ ! -d "$WEB_MIRROR" ]; then
    echo "ERROR: WEB_MIRROR does not exist: $WEB_MIRROR" >&2
    exit 3
fi
if [ ! -d "$PKG_MIRROR" ]; then
    echo "ERROR: PKG_MIRROR does not exist: $PKG_MIRROR" >&2
    exit 3
fi

say "$(bold '== detect-drift ==')  web=$WEB_MIRROR  pkg=$PKG_MIRROR"

# Build sorted basenames for each side; intersect to find common.
WEB_FILES=$(mktemp)
PKG_FILES=$(mktemp)
trap 'rm -f "$WEB_FILES" "$PKG_FILES"' EXIT

find "$WEB_MIRROR" -maxdepth 1 -type f -name '*.ts' -printf '%f\n' \
    | sort > "$WEB_FILES"
find "$PKG_MIRROR" -maxdepth 1 -type f -name '*.ts' -printf '%f\n' \
    | sort > "$PKG_FILES"

WEB_ONLY=$(comm -23 "$WEB_FILES" "$PKG_FILES" || true)
PKG_ONLY=$(comm -13 "$WEB_FILES" "$PKG_FILES" || true)
COMMON=$(comm -12 "$WEB_FILES" "$PKG_FILES" || true)

common_n=$(printf '%s\n' "$COMMON" | sed '/^$/d' | wc -l | tr -d ' ')
web_only_n=$(printf '%s\n' "$WEB_ONLY" | sed '/^$/d' | wc -l | tr -d ' ')
pkg_only_n=$(printf '%s\n' "$PKG_ONLY" | sed '/^$/d' | wc -l | tr -d ' ')

say "  common=$common_n  web-only=$web_only_n  pkg-only=$pkg_only_n"

# Mirror-missing: each is a separate failure category.
mm_failed=0
if [ -n "$WEB_ONLY" ]; then
    mm_failed=1
    say ""
    say "$(yellow '[MIRROR-MISSING]') files present in WEB_MIRROR but not in PKG_MIRROR:"
    while IFS= read -r f; do
        [ -n "$f" ] && say "  $(yellow '-') $f"
    done <<< "$WEB_ONLY"
fi
if [ -n "$PKG_ONLY" ]; then
    mm_failed=1
    say ""
    say "$(yellow '[MIRROR-MISSING]') files present in PKG_MIRROR but not in WEB_MIRROR:"
    while IFS= read -r f; do
        [ -n "$f" ] && say "  $(yellow '-') $f"
    done <<< "$PKG_ONLY"
fi

# Drift: diff each common basename.
sync_failed=0
in_sync=0
out_sync=0

if [ -n "$COMMON" ]; then
    say ""
    say "$(bold '[DIFF]') per-common diff (size in bytes; web vs pkg)"
    while IFS= read -r f; do
        [ -z "$f" ] && continue
        web_f="$WEB_MIRROR/$f"
        pkg_f="$PKG_MIRROR/$f"
        if cmp -s "$web_f" "$pkg_f"; then
            in_sync=$((in_sync + 1))
            [ "$QUIET" = "1" ] || say "  $(green 'IN_SYNC  ') $f"
        else
            out_sync=$((out_sync + 1))
            sync_failed=1
            sz_w=$(wc -c < "$web_f" | tr -d ' ')
            sz_p=$(wc -c < "$pkg_f" | tr -d ' ')
            delta=$((sz_w - sz_p))
            patch="$DIFF_OUT_DIR/${f%.ts}.patch"
            diff -u "$pkg_f" "$web_f" > "$patch" || true
            say "  $(red 'OUT_OF_SYNC') $f  web=$sz_w pkg=$sz_p delta=$delta  patch=$patch"
        fi
    done <<< "$COMMON"
fi

# Summary.
say ""
say "$(bold '== summary ==')"
say "  in_sync = $in_sync / $common_n common"
say "  out_sync = $out_sync"
say "  web-only = $web_only_n"
say "  pkg-only = $pkg_only_n"

# Decide exit code.
if [ "$mm_failed" -eq 1 ] && [ "$sync_failed" -eq 1 ]; then
    say ""
    say "$(red 'CI FAIL:') drift + mirror-missing detected"
    exit 1
elif [ "$sync_failed" -eq 1 ]; then
    say ""
    say "$(red 'CI FAIL:') drift detected — review patches in $DIFF_OUT_DIR"
    exit 1
elif [ "$mm_failed" -eq 1 ]; then
    say ""
    say "$(yellow 'CI FAIL:') mirror-missing files — create the missing side"
    exit 2
else
    say ""
    say "$(green 'CI PASS:') mirror is byte-identical, no mirror-missing files"
    exit 0
fi
