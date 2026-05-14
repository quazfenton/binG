#!/usr/bin/env bash
# Vercel build wrapper for binG web
#
# Next.js 16 Turbopack crashes during "Generating static pages" on
# /_global-error with: TypeError: Cannot read properties of null
# (reading 'useContext'). This is a known Turbopack bug.
#
# The server bundle IS fully compiled before static generation begins.
# Since the root layout has force-dynamic, we don't need static HTML
# snapshots. The crash only prevents BUILD_ID and a few static HTML
# files from being written — the server bundle is complete.
#
# Strategy:
#   1. Run 'next build' and capture exit code + stderr
#   2. If success (exit 0) → deploy as-is
#   3. If the known Turbopack error → verify server bundle is intact,
#      create missing BUILD_ID, exit 0
#   4. Any other error → fail the build
#
set -o pipefail

OUTDIR=".next"
STDERR_LOG="/tmp/next-build-stderr.log"

# ── Run the build ─────────────────────────────────────────────────────
NODE_OPTIONS="--max-old-space-size=4096" npx next build 2>"$STDERR_LOG"
BUILD_EXIT=$?

# ── Success path ──────────────────────────────────────────────────────
if [ $BUILD_EXIT -eq 0 ]; then
  echo "✓ Build succeeded"
  exit 0
fi

# ── Check if this is the known Turbopack /_global-error crash ─────────
if ! grep -qE "(useContext|Cannot read properties of null).*(null|useContext)" "$STDERR_LOG" 2>/dev/null; then
  echo "✗ Build failed with exit code $BUILD_EXIT (unexpected error)"
  echo "Last 60 lines of stderr:"
  tail -60 "$STDERR_LOG"
  exit $BUILD_EXIT
fi

echo ""
echo "⚠  Known Next.js 16 Turbopack bug: /_global-error prerender crashed."
echo "   Server bundle is already compiled. Verifying output integrity..."

# ── Verify critical build artifacts exist ─────────────────────────────
MISSING=""

# Check for the main app server entry. The route group (main) produces
# .next/server/app/(main)/page.js
if [ ! -f "$OUTDIR/server/app/(main)/page.js" ] && [ ! -f "$OUTDIR/server/app/page.js" ]; then
  # Try to find ANY page.js in the server output
  PAGE_JS=$(find "$OUTDIR/server/app" -name "page.js" 2>/dev/null | head -1)
  if [ -z "$PAGE_JS" ]; then
    MISSING="$MISSING  - No server page entry found (no page.js in server/app)\n"
  else
    echo "   Found page entry: $PAGE_JS"
  fi
else
  echo "   Server page entry exists."
fi

# Check for compiled chunks (proves Turbopack compilation succeeded)
CHUNK_COUNT=$(find "$OUTDIR/server/chunks" -name "*.js" 2>/dev/null | wc -l)
if [ "$CHUNK_COUNT" -lt 10 ]; then
  MISSING="$MISSING  - Too few server chunks ($CHUNK_COUNT) — build likely incomplete\n"
else
  echo "   Server chunks found: $CHUNK_COUNT"
fi

# Check static assets (CSS, JS bundles for client)
if [ ! -d "$OUTDIR/static" ]; then
  MISSING="$MISSING  - No static/ directory — client assets missing\n"
else
  echo "   Static assets directory exists."
fi

# Check routes manifest (needed for Vercel routing)
if [ ! -f "$OUTDIR/routes-manifest.json" ]; then
  MISSING="$MISSING  - No routes-manifest.json — routing will be broken\n"
else
  echo "   Routes manifest exists."
fi

if [ -n "$MISSING" ]; then
  echo ""
  echo "✗ Build output is INCOMPLETE. Cannot proceed with deployment."
  echo "Missing:"
  printf "%b" "$MISSING"
  echo ""
  echo "Last 60 lines of stderr:"
  tail -60 "$STDERR_LOG"
  exit 1
fi

# ── Create BUILD_ID if missing (Next.js writes it after static generation) ─
if [ ! -f "$OUTDIR/BUILD_ID" ]; then
  BUILD_ID_VALUE="${VERCEL_GIT_COMMIT_SHA:-deploy-$(date +%s)}"
  echo "$BUILD_ID_VALUE" > "$OUTDIR/BUILD_ID"
  echo "   Created BUILD_ID: $BUILD_ID_VALUE"
fi

echo ""
echo "✓ Server bundle verified — deployment will proceed."
echo "   (/_global-error static page skipped due to Turbopack bug)"
echo ""
exit 0
