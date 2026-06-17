#!/usr/bin/env bash
set -euo pipefail

# git pre-push hook — guards against truncated, corrupted, or regressed files
# from bad LLM edits that might slip through unnoticed.
#
# Install:  cp scripts/git-pre-push.sh .git/hooks/pre-push
#           chmod +x .git/hooks/pre-push

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FAILURES=()

while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
    range="$local_sha"
  else
    range="$remote_sha..$local_sha"
  fi

  echo "🔍 Checking commits in range: $range"

  changed_files=$(git diff --name-only "$range" \
    | grep -vE '\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|mp4|mp3|webp|zip|tar|gz|lock|heapsnapshot|map|br)$' \
    | grep -vE '(^|/)(\.git/hooks/pre-push|scripts/git-pre-push\.sh)$' \
    || :)

  if [ -z "$changed_files" ]; then
    continue
  fi

  # Use mapfile + quoted arrays to handle filenames with spaces/special
  # chars safely. `echo $prod_files | xargs grep` is unsafe because xargs
  # word-splits on whitespace and chokes on single-quoted names.
  mapfile -t changed_files_arr <<< "$changed_files"

  # ── Layer 1: Truncation / corruption markers ──────────────────────────
  # Explicit markers that LLMs emit when they clip output or leave
  # placeholder artifacts. Skip test files — they may legitimately assert
  # truncation behavior (e.g. `expect(truncate(s, 100)).toBe('...')`).
  prod_files=$(echo "$changed_files" | grep -vE '(^|/)(__tests__/|\.test\.|\.spec\.)' || :)
  if [ -n "$prod_files" ]; then
    mapfile -t prod_files_arr <<< "$prod_files"
    marker_hits=$(grep -nE \
      'TODO_RESTORE|CUT_HERE|\[REST_OF_FILE\]|\[CODE_CONTINUES\]|\.\.\\ remainder omitted|\.\.\. \d+ more lines?\.\.\.|\[OUTPUT_TRUNCATED\]|\[FILE_TRUNCATED\]|\[CONTENT_SKIPPED\]' \
      "${prod_files_arr[@]}" 2>/dev/null || :)
    if [ -n "$marker_hits" ]; then
      echo "❌ Layer 1 — Truncation/corruption markers found:"
      echo "$marker_hits"
      FAILURES+=("truncation-markers")
    fi
  fi

  # ── Layer 2: AI artifact / placeholder patterns ───────────────────────
  # Patterns that indicate an LLM hallucinated content instead of
  # preserving real code. NOTE: `__PLACEHOLDER__` (with double underscores)
  # is the LLM artifact marker. Single-word `PLACEHOLDER` in legitimate
  # variable names like `PLACEHOLDER_REGEX` is allowed.
  # Layer 2 scans ALL changed files (including test files) because test
  # files should not contain unreplaced placeholder strings either.
  artifact_hits=$(grep -nE \
    'YOUR_API_KEY_HERE|INSERT_CODE_HERE|__PLACEHOLDER__|FIXME_AUTO|REPLACE_WITH|\[IMPLEMENTATION_DETAILS\]|\[ADD YOUR|\[FILL IN\]' \
    "${changed_files_arr[@]}" 2>/dev/null || :)
  if [ -n "$artifact_hits" ]; then
    echo "⚠️  Layer 2 — AI artifact/placeholder patterns found:"
    echo "$artifact_hits"
    FAILURES+=("ai-artifacts")
  fi

  # ── Layer 3: Structural integrity (shrinkage + brace balance + exports + functions) ──
  if [ -x "$SCRIPT_DIR/integrity-check.py" ]; then
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-shrinkage --range "$range"; then
      FAILURES+=("shrinkage")
    fi
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-braces --range "$range"; then
      FAILURES+=("unbalanced-braces")
    fi
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-exports --range "$range"; then
      FAILURES+=("export-loss")
    fi
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-functions --range "$range"; then
      FAILURES+=("lost-functions")
    fi
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-syntax --range "$range"; then
      FAILURES+=("syntax-errors")
    fi
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-truncation --range "$range"; then
      FAILURES+=("truncation")
    fi
    # Per-commit check catches issues that were introduced and later fixed
    # within the same push range — range-endpoint comparison would miss it.
    if ! "$SCRIPT_DIR/integrity-check.py" --mode check-each-commit --range "$range"; then
      FAILURES+=("per-commit-integrity")
    fi
  fi

  # ── Layer 4: Line-count corruption (severe shrinkage) ──────────────────
  # Catches accidental truncation or full-file overwrite. Uses two tiers:
  #   ERROR:  >1000 lines lost OR >50% loss (blocking)
  #   WARN:   >200 lines lost OR >30% loss (non-blocking, printed for review)
  for f in "${changed_files_arr[@]}"; do
    if [ "$remote_sha" = "0000000000000000000000000000000000000000" ]; then
      base_ref="${local_sha}^"
    else
      base_ref="$remote_sha"
    fi
    old_lines=$(git show "$base_ref:$f" 2>/dev/null | wc -l | head -1 | tr -d '[:space:]' || true)
    new_lines=$(git show "$local_sha:$f" 2>/dev/null | wc -l | head -1 | tr -d '[:space:]' || true)
    old_lines=${old_lines:-0}
    new_lines=${new_lines:-0}
    [[ "$old_lines" =~ ^[0-9]+$ ]] || old_lines=0
    [[ "$new_lines" =~ ^[0-9]+$ ]] || new_lines=0
    if [ "$old_lines" -gt 100 ] && [ "$new_lines" -gt 0 ]; then
      lost=$(( old_lines - new_lines ))
      if [ "$lost" -gt 0 ]; then
        ratio=$(echo "scale=4; $new_lines / $old_lines" | bc 2>/dev/null || echo 1)
        if [ "$lost" -gt 1000 ] || [ "$(echo "$ratio < 0.50" | bc 2>/dev/null || echo 0)" = "1" ]; then
          echo "❌ Layer 4 — $f: ${old_lines} → ${new_lines} lines (${lost} lost, ${ratio}% of original, likely truncation)"
          FAILURES+=("overwrite:$f")
        elif [ "$lost" -gt 200 ] || [ "$(echo "$ratio < 0.70" | bc 2>/dev/null || echo 0)" = "1" ]; then
          echo "⚠️  Layer 4 — $f: ${old_lines} → ${new_lines} lines (${lost} lost, ${ratio}% of original, significant shrinkage)"
          # Warning only — not blocking
        fi
      fi
    fi
  done

done

# ── Summary ─────────────────────────────────────────────────────────────
if [ ${#FAILURES[@]} -gt 0 ]; then
  echo ""
  echo "❌ Pre-push checks FAILED (${#FAILURES[@]} issue(s)):"
  for f in "${FAILURES[@]}"; do
    echo "   - $f"
  done
  echo ""
  echo "Push blocked. Fix the issues above or push with --no-verify to bypass."
  exit 1
fi

echo "✅ Pre-push integrity checks passed."
