#!/usr/bin/env bash
# Vercel build wrapper for binG web — static export mode
#
# With output: 'export', Next.js generates a fully static site (out/)
# with no serverless functions. All API calls go to the external backend.
#
set -o pipefail

OUTDIR="out"
STDERR_LOG="/tmp/next-build-stderr.log"

# ── Step 0: Stash app/api so static export ignores backend routes ──────
# The Oracle backend serves every /api/* route, so the Vercel build does
# not need them. We MOVE the dir out of the build path before `next build`
# and restore it afterwards, even on failure. This replaces the previous
# (destructive) approach of deleting route.ts files.
API_DIR="app/api"
API_STASH="/tmp/bing-app-api-stash-$$"

restore_api() {
  if [ -d "$API_STASH" ] && [ ! -d "$API_DIR" ]; then
    mkdir -p "$(dirname "$API_DIR")"
    mv "$API_STASH" "$API_DIR"
    echo "↩  Restored $API_DIR from stash."
  fi
}
trap restore_api EXIT INT TERM

if [ -d "$API_DIR" ]; then
  mv "$API_DIR" "$API_STASH"
  echo "📦 Stashed $API_DIR → $API_STASH (kept off the Vercel build path)"
fi

# ── Step 1: Sync vendored monorepo packages ───────────────────────────
# Copies packages/shared and packages/platform into web/.bing-*
# so TypeScript path aliases (@bing/shared, @bing/platform) resolve.
echo "Syncing vendored monorepo packages..."
node scripts/sync-vendored-packages.mjs 2>&1 || {
  echo "⚠  Vendored package sync failed — continuing anyway (build may fail)"
}

# ── Step 2: Run the build ─────────────────────────────────────────────
NODE_OPTIONS="--max-old-space-size=4096" npx next build --webpack 2>"$STDERR_LOG"
BUILD_EXIT=$?

# ── Success path ──────────────────────────────────────────────────────
if [ $BUILD_EXIT -eq 0 ]; then
  # Verify static output exists
  if [ -d "$OUTDIR" ] && [ -f "$OUTDIR/index.html" ]; then
    echo "✓ Static export build succeeded — $OUTDIR/index.html generated"
    echo "   Static file count: $(find "$OUTDIR" -type f 2>/dev/null | wc -l)"
    exit 0
  fi
  echo "⚠  Build exit code 0 but $OUTDIR/index.html missing — may be incomplete"
fi

# ── Build failed — check if it's the known Turbopack /_global-error crash ─
if grep -qE "(useContext|Cannot read properties of null).*(null|useContext)" "$STDERR_LOG" 2>/dev/null; then
  echo ""
  echo "⚠  Known Next.js 16 Turbopack bug: /_global-error prerender crashed."
  echo "   Verifying static output integrity..."
  
  MISSING=""
  
  if [ ! -d "$OUTDIR" ]; then
    MISSING="$MISSING  - No $OUTDIR/ directory — static export failed\n"
  elif [ ! -f "$OUTDIR/index.html" ]; then
    MISSING="$MISSING  - No index.html — main page missing\n"
  fi
  
  STATIC_FILE_COUNT=$(find "$OUTDIR" -type f 2>/dev/null | wc -l)
  if [ "$STATIC_FILE_COUNT" -lt 5 ]; then
    MISSING="$MISSING  - Too few static files ($STATIC_FILE_COUNT) — build likely incomplete\n"
  fi
  
  if [ -n "$MISSING" ]; then
    echo "✗ Static export incomplete:"
    printf "%b" "$MISSING"
    tail -40 "$STDERR_LOG"
    exit 1
  fi
  
  echo "✓ Static export verified — $STATIC_FILE_COUNT files generated"
  exit 0
fi

# ── Real error ────────────────────────────────────────────────────────
echo "✗ Build failed with exit code $BUILD_EXIT"
echo "Last 60 lines of stderr:"
tail -60 "$STDERR_LOG"
exit $BUILD_EXIT
