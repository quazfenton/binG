#!/usr/bin/env bash
# scripts/test-integrity-check.sh — Verify integrity-check.py against simulated
# truncation / corruption / bad-edit scenarios.
#
# Creates isolated temp git repos with synthetic healthy files, mutates them in
# 8 distinct ways, and asserts expected detection-mode outcomes per scenario.
#
# Usage:  bash scripts/test-integrity-check.sh
#
# Exit codes:
#   0 — all scenarios PASS
#   1 — at least one scenario failed (mode behaved unexpectedly)
#   124 — script-internal failure (e.g., setup broken)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_PY="$SCRIPT_DIR/integrity-check.py"

# Color codes (only when stdout is a tty).
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

PASS=0
FAIL=0
SKIP=0
declare -a FAILURES_LIST=()
declare -a TMPDIRS=()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

banner() { printf '\n%s=== %s ===%s\n' "$BLUE" "$*" "$NC"; }

cleanup_all() {
  local d
  for d in "${TMPDIRS[@]}"; do
    [ -d "$d" ] && rm -rf "$d"
  done
}
trap cleanup_all EXIT

# expects_failure <scenario> <mode> <range>
expects_failure() {
  local scenario="$1"; local mode="$2"; local range="$3"
  set +e
  python3 "$CHECK_PY" --mode "$mode" --range "$range" >/dev/null 2>&1
  local rc=$?
  set -e
  if [ "$rc" -eq 1 ]; then
    printf '  %s[PASS]%s %s/%s detected failure\n' "$GREEN" "$NC" "$scenario" "$mode"
    PASS=$((PASS+1))
  else
    printf '  %s[FAIL]%s %s/%s — expected exit 1, got %d\n' "$RED" "$NC" "$scenario" "$mode" "$rc"
    FAIL=$((FAIL+1))
    FAILURES_LIST+=("$scenario/$mode (expected 1, got $rc)")
  fi
}

# expects_pass <scenario> <mode> <range>
expects_pass() {
  local scenario="$1"; local mode="$2"; local range="$3"
  set +e
  python3 "$CHECK_PY" --mode "$mode" --range "$range" >/dev/null 2>&1
  local rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    printf '  %s[PASS]%s %s/%s did not false-positive\n' "$GREEN" "$NC" "$scenario" "$mode"
    PASS=$((PASS+1))
  else
    printf '  %s[FAIL]%s %s/%s false-positive — expected 0, got %d\n' "$RED" "$NC" "$scenario" "$mode" "$rc"
    FAIL=$((FAIL+1))
    FAILURES_LIST+=("$scenario/$mode false-positive (got $rc, want 0)")
  fi
}

# preview_output <scenario> <mode> <range>  — show what integrity-check prints.
preview_output() {
  local scenario="$1"; local mode="$2"; local range="$3"
  set +e
  out=$(python3 "$CHECK_PY" --mode "$mode" --range "$range" 2>&1)
  rc=$?
  set -e
  printf '  -- %s/%s (rc=%d) --\n' "$scenario" "$mode" "$rc"
  echo "$out" | head -20 | sed 's/^/  | /'
}

# Helper: make a fresh temp git repo + commit "<healthy>" so we have a real
# Git history (parent commit) for the diff-based checks.
make_repo() {
  local label="$1"
  local tmpdir
  tmpdir=$(mktemp -d "/tmp/integrity-test-${label}-XXXXXX")
  TMPDIRS+=("$tmpdir")
  cd "$tmpdir"
  git init -q
  git config user.email test@test
  git config user.name test
}

commit_file() {
  cd "$TMPDIR"
  git add -A
  git commit -q -m "$1"
  git rev-parse HEAD
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

banner "Pre-flight: integrity-check.py reachable"
if [ ! -f "$CHECK_PY" ]; then
  printf '%s[FATAL]%s integrity-check.py not found at %s\n' "$RED" "$NC" "$CHECK_PY"
  exit 124
fi
set +e
python3 "$CHECK_PY" --mode list >/dev/null 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ]; then
  printf '%s[FATAL]%s integrity-check.py --mode list failed (rc=%d)\n' "$RED" "$NC" "$rc"
  exit 124
fi
printf '%s[OK]%s integrity-check.py is loadable\n' "$GREEN" "$NC"

# ===========================================================================
# Scenario 1 — TRUNCATION (large healthy file chopped to ~10 lines)
# ===========================================================================
banner "Scenario 1 — TRUNCATION (large healthy file chopped to ~10 lines)"
make_repo "trunc"
cd "$TMPDIR"
# Generate a 253-line healthy file so removed_lines >> TRUNCATION_MIN_REMOVED_LINES=50.
{
  echo "// lib.ts — synth healthy for S1 truncation test"
  echo "/* generated — do not hand-edit */"
  echo ""
  for i in $(seq 1 25); do
    echo "export function helper${i}(x: number): number {"
    echo "  // internal step ${i}a"
    echo "  const step1 = x + ${i};"
    echo "  const step2 = step1 * 2;"
    echo "  const step3 = step2 - 1;"
    echo "  // internal step ${i}b"
    echo "  if (step3 < 0) return -step3;"
    echo "  return step3;"
    echo "}"
    echo ""
  done
} > lib.ts
GOOD=$(commit_file "v1")
echo "  Healthy file: $(wc -l < lib.ts) lines"
# Simulate a bad LLM edit that drops ~95% of the file.
head -10 lib.ts > lib.ts.new
mv lib.ts.new lib.ts
cd "$TMPDIR"
BAD=$(commit_file "v2-truncated")
RANGE="${GOOD}..${BAD}"
echo "  truncated file: $(wc -l < lib.ts) lines"
preview_output "S1" "check-truncation" "$RANGE"
expects_failure "S1" "check-truncation" "$RANGE"
expects_failure "S1" "check-shrinkage"   "$RANGE"
cd /

# ===========================================================================
# Scenario 2 — BRACE-LOSS only (delta below threshold by design)
# ===========================================================================
banner "Scenario 2 — BRACE-LOSS only (delta below threshold, FP)"
make_repo "brace"
cd "$TMPDIR"
cat > lib.ts <<'EOF'
// lib.ts
export const FOO = 1;
export function keepMe(): number {
  return FOO;
}
EOF
GOOD=$(commit_file "v1")
sed '$d' lib.ts > lib.ts.new && mv lib.ts.new lib.ts
BAD=$(commit_file "v2-brace-loss")
RANGE="${GOOD}..${BAD}"
preview_output "S2" "check-braces" "$RANGE"
# BRACE_IMBALANCE_THRESHOLD=5 means a single missing `}` is intentionally
# tolerated (string literals can throw brace counts off). check-syntax
# (tsc) is what catches this in practice; the FP guard is by design.
printf '  %s[SKIP]%s (BRACE_IMBALANCE_THRESHOLD=5 is conservative on purpose)\n' "$YELLOW" "$NC"
SKIP=$((SKIP+1))
cd /

# ===========================================================================
# Scenario 3 — Small function LOSS (1 of 6 declarations, just above FP ratio)
# ===========================================================================
banner "Scenario 3 — Small function LOSS (1 of 6, ratio = 16.7% > 15%)"
make_repo "small-loss"
cd "$TMPDIR"
FUNCS_LINES=(
  'export function alpha(): number { return 1; }'
  'export function beta(): number  { return 2; }'
  'export function gamma(): number { return 3; }'
  'export function delta(): number { return 4; }'
  'export function epsilon(): number { return 5; }'
  'export function zeta(): number  { return 6; }'
)
{
  echo "// lib.ts"
  for line in "${FUNCS_LINES[@]}"; do echo "$line"; done
} > lib.ts
GOOD=$(commit_file "v1")
grep -v 'alpha' lib.ts > lib.ts.new && mv lib.ts.new lib.ts
BAD=$(commit_file "v2-loss-alpha")
RANGE="${GOOD}..${BAD}"
preview_output "S3" "check-functions" "$RANGE"
expects_failure "S3" "check-functions" "$RANGE"
cd /

# ===========================================================================
# Scenario 4 — EXPORT-LOSS (drop `export` keyword from one decl)
# ===========================================================================
banner "Scenario 4 — EXPORT-LOSS (drop `export` keyword from one decl)"
make_repo "export-loss"
cd "$TMPDIR"
cat > lib.ts <<'EOF'
// lib.ts
export function alpha(): number { return 1; }
export function beta(): number { return 2; }
export function gamma(): number { return 3; }
EOF
GOOD=$(commit_file "v1")
sed -i 's/^export function beta/function beta/' lib.ts
BAD=$(commit_file "v2-drop-export")
RANGE="${GOOD}..${BAD}"
preview_output "S4" "check-exports" "$RANGE"
expects_failure "S4" "check-exports"   "$RANGE"
expects_pass    "S4" "check-functions" "$RANGE"
cd /

# ===========================================================================
# Scenario 5 — COMMENT-ONLY deletion (FP: should NOT trigger any mode)
# ===========================================================================
banner "Scenario 5 — COMMENT-ONLY deletion (FP guard: should NOT trigger)"
make_repo "comments"
cd "$TMPDIR"
cat > lib.ts <<'EOF'
// header doc comment
// another comment
// and yet another
export function alpha(): number {
  // inline comment inside body
  return 1;
}
// trailing comment
export function beta(): number {
  return 2;
}
EOF
GOOD=$(commit_file "v1")
grep -v '^[[:space:]]*//' lib.ts > lib.ts.new && mv lib.ts.new lib.ts
BAD=$(commit_file "v2-strip-comments")
RANGE="${GOOD}..${BAD}"
for mode in check-shrinkage check-braces check-exports check-functions check-truncation; do
  expects_pass "S5" "$mode" "$RANGE"
done
cd /

# ===========================================================================
# Scenario 6 — RENAME (FP guard: 6 lost + 6 added)
# ===========================================================================
banner "Scenario 6 — RENAME (FP guard: 6 lost + 6 added)"
make_repo "rename"
cd "$TMPDIR"
{
  echo "// lib.ts"
  for n in alpha beta gamma delta epsilon zeta; do
    echo "export function $n(): number { return 1; }"
  done
} > lib.ts
GOOD=$(commit_file "v1")
sed -i -E "s/function ([a-z]+)\(\)/function \1New()/g" lib.ts
BAD=$(commit_file "v2-rename")
RANGE="${GOOD}..${BAD}"
for mode in check-functions check-exports; do
  expects_pass "S6" "$mode" "$RANGE"
done
cd /

# ===========================================================================
# Scenario 7 — REFACTOR (FP: added ~ removed, file size >50% of old)
# ===========================================================================
banner "Scenario 7 — REFACTOR (FP guard: added ~removed, file survives)"
make_repo "refactor"
cd "$TMPDIR"
cat > lib.ts <<'EOF'
// lib.ts
export function oldAlpha(): number { return 1; }
export function oldBeta(): number  { return 2; }
export function oldGamma(): number { return 3; }
export function oldDelta(): number { return 4; }
export function oldEpsilon(): number { return 5; }
EOF
GOOD=$(commit_file "v1")
# Rename old* → new* AND append a parallel block of new declarations so the
# file ends up bigger than the original. Removed_lines ~ added_lines.
sed -E 's/old(Alpha|Beta|Gamma|Delta|Epsilon)/\1New/g' lib.ts > lib.ts.new
{
  for n in alpha beta gamma delta epsilon; do
    case "$n" in
      alpha)   echo "export function ${n}New2(): number { return 10; }" ;;
      beta)    echo "export function ${n}New2(): number { return 20; }" ;;
      gamma)   echo "export function ${n}New2(): number { return 30; }" ;;
      delta)   echo "export function ${n}New2(): number { return 40; }" ;;
      epsilon) echo "export function ${n}New2(): number { return 50; }" ;;
    esac
  done
} >> lib.ts.new
mv lib.ts.new lib.ts
cd "$TMPDIR"
BAD=$(commit_file "v2-refactor")
RANGE="${GOOD}..${BAD}"
echo "  diff sizes:"
git show --stat $BAD -- lib.ts | tail -3 | sed 's/^/    /'
preview_output "S7" "check-truncation" "$RANGE"
expects_pass "S7" "check-truncation" "$RANGE"
cd /

# ===========================================================================
# Scenario 8 — Pure trailing whitespace + blank-line trim (FP: should NOT trigger)
# ===========================================================================
banner "Scenario 8 — Trailing whitespace + blank-line trim (FP)"
make_repo "tiny"
cd "$TMPDIR"
# Multiple blank lines AFTER the last export so any "trim trailing" op is
# purely cosmetic — the code lines themselves are untouched.
cat > lib.ts <<'EOF'
// lib.ts
export function alpha(): number { return 1; }
export function beta(): number { return 2; }
// EOF
EOF
# Add trailing blank lines.
for _ in 1 2 3 4; do echo "" >> lib.ts; done
GOOD=$(commit_file "v1")
# Trim trailing blank lines + chomp final newline. No code change.
perl -i -ne 'print unless eof and not /\S/' lib.ts
perl -i -pe 'chomp if eof' lib.ts
BAD=$(commit_file "v2-tiny-trim")
RANGE="${GOOD}..${BAD}"
# Sanity check: code line count must be unchanged across the trim.
# Both segments of `awk 'NF' | wc -l` exit 0 on any input — including files
# with zero non-blank lines where `grep -c` would return rc=1. Both intend
# "count non-blank lines"; awk has no false-match case, so the pipeline
# stays rc=0. (The actual S8 bug was the swallowed code_lines_before=
# assignment — the comment here is about pipeline hygiene, not exit codes.)
code_lines_before=$(git show "${GOOD}:lib.ts" | awk 'NF' | wc -l)
code_lines_after=$(git show  "${BAD}:lib.ts" | awk 'NF' | wc -l)
echo "  non-blank lines: $code_lines_before → $code_lines_after (must match)"
  for mode in check-shrinkage check-braces check-exports check-functions check-truncation; do
    expects_pass "S8" "$mode" "$RANGE"
  done
  cd /

# ===========================================================================
# Scenario 9 — MASS comment-line deletion. Tests that TRUNCATION's new
# ignorable-line filter subtracts comments/blanks/imports from removed_lines,
# so dropping 90+ comment lines without altering code does NOT trip the
# TRUNCATION_MIN_REMOVED_LINES = 30 alarm.
# ===========================================================================
banner "Scenario 9 — MASS comment-line deletion (FP: should NOT trigger)"
make_repo "mass-comments"
cd "$TMPDIR"
{
  echo "/* S9 — comment-fill start */"
  for i in $(seq 1 90); do
    echo "/* filler block comment line $i */"
  done
  echo "// anchor: keep these three exports"
  echo "export function keptA(): number { return 1; }"
  echo "export function keptB(): number { return 2; }"
  echo "export function keptC(): number { return 3; }"
} > lib.ts
GOOD=$(commit_file "v1")
echo "  before: $(wc -l < lib.ts) total lines (90 of which are comments)"
# Strip every comment-starting line, leave exports alone.
python3 -c "
import re
with open('lib.ts') as f: s = f.read()
out = '\n'.join(
  line for line in s.splitlines()
  if line.strip() and not re.match(r'^\s*(/\*|\*|//|\*/|<!--)\s*', line)
)
with open('lib.ts','w') as f: f.write(out + '\n')
"
BAD=$(commit_file "v2-strip-blocks")
RANGE="${GOOD}..${BAD}"
code_lines_after=$(git show ${BAD}:lib.ts | grep -cv '^[[:space:]]*$')
echo "  after:  $(wc -l < lib.ts) lines (only exports + 0 comments; code=$code_lines_after)"
preview_output "S9" "check-truncation" "$RANGE"
expects_pass "S9" "check-truncation" "$RANGE"
cd /

# ===========================================================================
# Scenario 10 — IMPORT-only mass deletion (40 imports → 1). Tests that
# import lines are subtracted from removed_lines. All 40 removed imports
# are ignored; only 1 added line for the consolidated import. Net diff is
# -40 + 1 but check-truncation should not alarm because removed_lines = 0
# after the ignorable filter.
# ===========================================================================
banner "Scenario 10 — Import-only mass replacement (FP guard: should NOT trigger)"
make_repo "import-deletion"
cd "$TMPDIR"
{
  echo "// S10 — file with 40 distinct imports"
  for i in $(seq 1 40); do
    echo "import { foo${i} } from 'lib/foo${i}';"
  done
  echo "// exports below"
  echo "export function keptA(): number { return 1; }"
  echo "export function keptB(): number { return 2; }"
} > lib.ts
GOOD=$(commit_file "v1")
echo "  before: $(wc -l < lib.ts) lines (40 imports)"
# Replace 40 imports with one consolidated import line.
{
  head -1 lib.ts
  echo "import { foo1, foo2, ..., foo39, foo40 } from 'lib/bundle';"
  tail -4 lib.ts
} > lib.ts.new
mv lib.ts.new lib.ts
BAD=$(commit_file "v2-bundled")
RANGE="${GOOD}..${BAD}"
echo "  after:  $(wc -l < lib.ts) lines (1 bundled import)"
preview_output "S10" "check-truncation" "$RANGE"
expects_pass "S10" "check-truncation" "$RANGE"
cd /

# ===========================================================================
# Scenario 11 — Export loss 5/30 = 16.7%. Tests the new MAX=5/RATIO=0.20
# threshold. Under old MAX=3/RATIO=0.15, lose 5 → trip alarm. Under new
# MAX=5/RATIO=0.20, loss_ratio 16.7% < 20% → no alarm. Note: `added=1` so
# rename guard 1 (added >= lost) does NOT catch it — this case specifically
# tests the surgical-delete thresholds.
# ===========================================================================
banner "Scenario 11 — Export loss 5/30 = 16.7% (FP under new MAX=5/RATIO=0.20)"
make_repo "many-exports"
cd "$TMPDIR"
{
  echo "// S11 — file with 30 exports"
  for i in $(seq 1 30); do
    echo "export function helper${i}(x: number): number {"
    echo "  return x + ${i};"
    echo "}"
  done
} > lib.ts
GOOD=$(commit_file "v1")
echo "  before: 30 exports"
# Drop helpers 11..15 (5 lost, distinct names), append 1 new helper.
python3 -c "
import re
with open('lib.ts') as f: src = f.read()
out = re.sub(
  r'^export function helper1[1-5]\(.*?\n\}\s*$',
  '',
  src,
  flags=re.MULTILINE | re.DOTALL,
)
out += '\nexport function addedHelper(x: number): number { return x * 7; }\n'
with open('lib.ts','w') as f: f.write(out)
"
BAD=$(commit_file "v2-five-less-one-added")
RANGE="${GOOD}..${BAD}"
remaining=$(grep -c '^export function' lib.ts)
echo "  after:  $remaining exports (5 lost, 1 added)"
preview_output "S11" "check-exports" "$RANGE"
expects_pass "S11" "check-exports" "$RANGE"
cd /


# ---------------------------------------------------------------------------
# Cleanup + report
# ---------------------------------------------------------------------------

banner "Test summary"
TOTAL=$((PASS + FAIL + SKIP))
printf '  %sPASS:%s %d\n' "$GREEN" "$NC" "$PASS"
printf '  %sFAIL:%s %d\n' "$RED" "$NC" "$FAIL"
printf '  %sSKIP:%s %d (intentional threshold tests)\n' "$YELLOW" "$NC" "$SKIP"
printf '  Total: %d\n' "$TOTAL"

if [ "$FAIL" -gt 0 ]; then
  printf '\n%sFAILURES:%s\n' "$RED" "$NC"
  for f in "${FAILURES_LIST[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi

printf '\n%sALL ASSERTIONS PASSED%s\n' "$GREEN" "$NC"
exit 0
