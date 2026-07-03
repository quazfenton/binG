#!/usr/bin/env python3
"""
integrity-check.py — Detect truncated, corrupted, or regressed files from bad
LLM edits before they reach the remote.

DESIGN
=======
- Single output path: every diagnostic message goes through `emit()`,
  which appends to a module-level `_BUFFER` list. `flush()` (registered
  via atexit + called from `fail()`) writes the entire buffer to stderr
  in one go at program exit. This replaces the previous implementation's
  per-line `_sb` lambda that spawned a `python3 -c` subprocess for every
  diagnostic line — slow, but the only reliable escape hatch in the
  prior environment.
- Direct writes from this script are also tested working inside the
  pre-push hook context (the prior concern was bash capturing things
  weirdly; buffering + atexit sidesteps that entirely).
- Exit codes:
    0 — no issues detected
    1 — issues detected (caller in git-pre-push.sh appends to FAILURES[])
    2 — script internal error (uncaught exception)
- Each detection mode is independent and may call `fail()` if it finds a
  problem; the atexit flush ensures the operator always sees before-exit
  diagnostics regardless of which mode triggered the exit.

DETECTION MODES (--mode <name>)
================================
- check-shrinkage     File size dropped >50% of original (chars).
- check-braces        Old balanced, new unbalanced, |delta| > 5.
- check-exports       Pure export names before/after — flags dropped.
- check-functions     Function/class decl names before/after. FP guards:
                      rename (added ~ lost) and tiny-loss (<=3 / <15%).
- check-truncation    Removed-hunk analysis from `git diff -U5`. Reports
                      file, removed line ranges, 10-line preview, and
                      any function names caught in the removed block.
                      FP guard: skip if `added >= 0.3 * removed` AND
                      `new_len > 0.5 * old_len` (legit refactor).
- check-syntax        Per-file `tsc --noEmit` / `node --check` /
                      `py_compile` depending on extension.
- check-each-commit   Run shrink/braces/exports/functions/truncation
                      against every individual commit in the range;
                      catches truncation that was later fixed within
                      the same push range.

FALSE-POSITIVE GUARDS
=====================
Hit-rate tuning moved to constants near top-of-file:
- FUNC_LOSS_FP_GUARD_MAX = 3                (small surgical deletes)
- FUNC_LOSS_FP_GUARD_RATIO = 0.15           (<15% of all decls lost)
- TRUNCATION_MIN_REMOVED_LINES = 50         (skip smaller diff hunk noise)
- BRACE_IMBALANCE_THRESHOLD = 5             (avoid braces-in-strings false +
                      positives — string templates can have unbalanced parens)
- SHRINK_RATIO_BLOCK = 0.5                 (block on <50% size)
- SHRINK_RATIO_WARN = 0.7                   (warn on <70% size)
"""
import sys
import tempfile

import os
import re
import subprocess
import argparse
import atexit
from pathlib import Path


# ===========================================================================
# Output mechanism
# ===========================================================================

# Module-level buffer. ALL output goes through here.
# Flushed at atexit / on fail() / explicitly via flush().
_BUFFER: list[str] = []


def emit(msg: str) -> None:
    """Append a single line to the output buffer.

    Output is NOT flushed to stderr here — atexit / finally blocks do that.
    This is intentional: direct stderr writes mid-check were unreliable in
    the prior implementation, so we buffer everything and flush at program
    termination. Order is preserved (FIFO append).
    """
    _BUFFER.append(msg)


def emit_block(title: str, lines: list[str]) -> None:
    """Emit a title line followed by a list of indented sub-lines."""
    emit(title)
    for line in lines:
        emit(f"  {line}")


def flush() -> None:
    """Flush buffered output to stderr in one write.

    Tries sys.stderr.write + explicit flush first (works in 99% of cases
    including inside `git push` hook capture). Falls back to a single
    subprocess `python3 -c` call if direct write fails (rare — e.g. EPIPE
    on a closed parent fd).
    Idempotent — safe to call multiple times.
    """
    if not _BUFFER:
        return
    payload = "\n".join(_BUFFER) + "\n"
    _BUFFER.clear()

    try:
        sys.stderr.write(payload)
        sys.stderr.flush()
        return
    except (OSError, ValueError):
        pass

    # Subprocess fallback — only reachable if direct stderr write failed.
    try:
        subprocess.check_call(
            ["python3", "-c",
             "import sys; sys.stderr.write({!r}); sys.stderr.flush()".format(payload)],
        )
    except Exception as e:
        # Last resort. Report the failure so corrupted files aren't silently skipped.
        try:
            sys.stderr.write(f"[integrity-check] syntax-check subprocess fallback also failed: {e}\n")
            sys.stderr.flush()
        except Exception:
            pass


# atexit covers sys.exit() from inside check_*(). When fail() is called,
# we also flush() explicitly before sys.exit to ensure ordering.
atexit.register(flush)


def fail() -> None:
    """Flush buffer, then exit with code 1."""
    flush()
    sys.exit(1)


# ===========================================================================
# Tunables — adjust here to tune false-positive vs true-positive trade-off
# ===========================================================================

# Don't trigger on:
#  -1 "-N" surgical edits that drop at most this many declarations, OR
#  -2 drops whose size is < this fraction of all old declarations.
# Tuned FP-vs-recall:
#   MAX=3 / RATIO=0.15 was too easy to trip on legitimate class-method
#   consolidation (10 helpers + 3 consolidated → 4 lost = FP).
FUNC_LOSS_FP_GUARD_MAX = 5
FUNC_LOSS_FP_GUARD_RATIO = 0.20

# Truncation detection: skip if removed diff hunk is smaller than this
# many *code* lines. Pure comments and import lines are excluded from
# the count first (see `_IGNORABLE_LINE_PREFIXES`), so this threshold
# is the actionable-code-loss floor — 30 lines of pure logic loss is
# significant. Default was 50; lowered when comment/import filtering
# was added (without the filter, 50 was needed to suppress comment-only
# diffs).
TRUNCATION_MIN_REMOVED_LINES = 30

# Brace imbalance threshold: skip if |delta_open - delta_close| is below
# this — prevents triggering on braces in string literals / ternary docs.
# Default 5 was missing real 2-3 brace losses; lowered to 3.
BRACE_IMBALANCE_THRESHOLD = 3

# Line prefixes that mark a removed line as NON-CODE (comments, imports,
# blanks). These are subtracted from `removed_lines` so a comment-only
# diff doesn't trip the truncation alarm. JS/TS-flavored first; Python,
# HTML/XML, JSX literals are covered by inspection.
_IGNORABLE_LINE_PREFIXES = (
    '//',       # JS/TS line comment
    '/*',       # JS/TS block comment opener
    '*',        # JS/TS block comment continuation
    '#',        # Python / shell / many config languages
    '<!--',     # HTML/XML comment
    '"""',      # Python triple-string
    "'''",      # Python triple-string alternative
    'import ',  # Python / JS / TS imports
    'from ',    # Python imports
)

# If a single hunk shows this many transitions between `-` and `+`
# (interleaved additions+removals), the diff is a real semantic rewrite
# rather than blind truncation. Skip the loss alarm on interleave alone.
HUNK_INTERLEAVE_TRANSITIONS_MIN = 5


def _is_ignorable_line(content: str) -> bool:
    """Return True if a removed line is comment / blank / import-only.

    Used by `check_truncation` to subtract comment-only diffs (e.g.
    prettier reformatting, JSDoc refresh, import reorganisation) from
    the actionable `removed_lines` count so they don't trip the
    TRUNCATION_MIN_REMOVED_LINES alarm. Pure comments and blank
    lines are scanning for `//`, `/*`, `#`, `<!--`, Python tripples,
    plus standalone `import` / `from` lines. Anything else is
    considered actionable code.
    """
    s = content.strip()
    if not s:
        return True
    return s.startswith(_IGNORABLE_LINE_PREFIXES)

# File shrinkage thresholds.
SHRINK_RATIO_BLOCK = 0.5        # <= 50% of original → blocking
SHRINK_RATIO_WARN = 0.7         # <= 70% of original → non-blocking warn

# Truncation false-positive guard: legit refactors add ~as much as they
# remove. If `added == removed * 0.3` AND `new_len > old_len * 0.5`, skip.
TRUNCATION_REFACTOR_ADDED_FRACTION = 0.3
TRUNCATION_REFACTOR_SIZE_FRACTION = 0.5

# Brace-pair tuples for structural balance check.
BRACE_PAIRS = [
    ("curly brace", "{", "}"),
    ("parenthesis", "(", ")"),
    ("square bracket", "[", "]"),
]

# Function/method/class declaration patterns.
FUNC_PATTERNS = [
    re.compile(r'(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(', re.MULTILINE),
    re.compile(r'(?:^|\s)(?:export\s+)?(?:default\s+)?class\s+(\w+)', re.MULTILINE),
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(', re.MULTILINE),
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function', re.MULTILINE),
    re.compile(r'^\s*(?:public|private|protected|static)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[{:]', re.MULTILINE),
    re.compile(r'(\w+)\s*[=:]\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*[{\(]', re.MULTILINE),
]

# Pure export patterns.
EXPORT_PATTERNS = [
    re.compile(r'^\s*export\s+(default\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)', re.MULTILINE),
    re.compile(r'^\s*export\s+\{([^}]+)\}', re.MULTILINE),
    re.compile(r'^\s*(def|class)\s+(\w+)', re.MULTILINE),  # Python top-level
]

# Per-extension syntax-check command templates.
EXT_SYNTAX_CHECK = {
    '.ts': ['npx', '--no', 'tsc', '--noEmit', '--pretty', 'false', '{file}'],
    '.tsx': ['npx', '--no', 'tsc', '--noEmit', '--pretty', 'false', '{file}'],
    '.js': ['node', '--check', '{file}'],
    '.mjs': ['node', '--check', '{file}'],
    '.py': ['python3', '-c', "import py_compile; py_compile.compile('{file}', doraise=True)"],
}

# Binary / non-text extensions to skip in structural checks.
SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
    '.woff2', '.woff', '.ttf', '.eot', '.mp4', '.mp3',
    '.webp', '.zip', '.tar', '.gz', '.lock', '.map', '.br',
    '.heapsnapshot',
}


# ===========================================================================
# Git helpers
# ===========================================================================

def _git(*args: str) -> str | None:
    """Run git with stderr swallowed. Returns stdout or None on error."""
    try:
        return subprocess.check_output(
            ["git", *args],
            stderr=subprocess.DEVNULL,
        ).decode(errors="replace")
    except subprocess.CalledProcessError as e:
        emit(f"[WARN] git command failed: git {' '.join(args)} (rc={e.returncode})")
        return None


def git_show(ref_path: str) -> str | None:
    return _git("show", ref_path)


def git_diff_names(commit_range: str) -> list[str]:
    out = _git("diff", "--name-only", commit_range) or ""
    return [f for f in out.splitlines() if f.strip()]


def git_diff_unified(commit_range: str, file_path: str) -> str | None:
    """Get unified diff (-U5) for one file across the range."""
    return _git("diff", "-U5", commit_range, "--", file_path)


def get_commit_range(commit_range: str) -> tuple[str, str]:
    if ".." in commit_range:
        start, end = commit_range.split("..", 1)
        return start, end
    # Bare SHA — treat as single-commit range vs its parent.
    return f"{commit_range}^", commit_range


# ===========================================================================
# Detection modes
# ===========================================================================

def check_shrinkage(commit_range: str) -> None:
    """File shrank to <50% of original (block) or <70% (warn)."""
    start, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")
        if old is None or new is None:
            continue

        old_len = len(old)
        new_len = len(new)
        if old_len <= 50 or new_len == 0:
            continue

        ratio = new_len / old_len
        if ratio < SHRINK_RATIO_BLOCK:
            emit(f"ERROR: {f} shrank to {ratio:.1%} of original size "
                 f"({old_len} \u2192 {new_len} chars). Possible truncation.")
            failed = True
        elif ratio < SHRINK_RATIO_WARN:
            emit(f"WARN: {f} shrank to {ratio:.1%} of original size "
                 f"({old_len} \u2192 {new_len} chars).")

    if failed:
        fail()


def check_braces(commit_range: str) -> None:
    """Brace/paren/bracket balance dropped — strong truncation indicator."""
    start, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        if Path(f).suffix.lower() in SKIP_EXTENSIONS:
            continue

        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")
        if old is None or new is None:
            continue

        for pair_name, open_ch, close_ch in BRACE_PAIRS:
            old_open = old.count(open_ch)
            old_close = old.count(close_ch)
            new_open = new.count(open_ch)
            new_close = new.count(close_ch)

            old_balanced = (old_open == old_close)
            new_balanced = (new_open == new_close)
            imbalance = abs(new_open - new_close)

            if old_balanced and not new_balanced and imbalance > BRACE_IMBALANCE_THRESHOLD:
                emit(
                    f"ERROR: {f} has unbalanced {pair_name}s "
                    f"({new_open} open vs {new_close} close, "
                    f"\u0394={imbalance}). Was balanced in parent commit."
                )
                failed = True

    if failed:
        fail()


def check_exports(commit_range: str) -> None:
    """Pure exports (sync getter via m.lastindex) — flags lost exports."""
    start, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        ext = Path(f).suffix.lower()
        if ext not in ('.ts', '.tsx', '.js', '.mjs', '.py'):
            continue

        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")
        if old is None or new is None:
            continue

        old_exports: set[str] = set()
        new_exports: set[str] = set()

        for pat in EXPORT_PATTERNS:
            for m in pat.finditer(old or ""):
                name = m.group(m.lastindex)
                if name:
                    old_exports.add(name.strip())
            for m in pat.finditer(new or ""):
                name = m.group(m.lastindex)
                if name:
                    new_exports.add(name.strip())

        lost = old_exports - new_exports
        added = new_exports - old_exports
        if not lost:
            continue

        # FP guard 1 — wholesale rename. If added exports roughly match lost,
        # the diff is a rename/refactor (e.g. `alpha` → `alphaNew`) rather
        # than corruption. Triggered at any size so wholesale renames (6
        # lost + 6 added) also pass cleanly.
        if len(added) >= len(lost):
            continue

        # FP guard 2 — small surgical delete.
        # Single-decl losses always trip (1/300 = 0.33% looks tiny but a
        # missing export is intentional). Multi-decl losses only trip when
        # the ratio rises above RATIO. This tiered structure preserves
        # S3 (1/6 lost, ratio 16.7% — should alarm) as a regression check
        # while keeping S11 (5/30 lost, ratio 16.7% — should pass) green
        # under MAX=5/RATIO=0.20.
        if len(lost) > 1:
            total_old = len(old_exports) or 1
            loss_ratio = len(lost) / total_old
            if len(lost) <= FUNC_LOSS_FP_GUARD_MAX and loss_ratio < FUNC_LOSS_FP_GUARD_RATIO:
                continue

        sample = ", ".join(sorted(lost)[:8])
        more = "" if len(lost) <= 8 else f" (+{len(lost) - 8} more)"
        emit(f"ERROR: {f} lost exports: {sample}{more}")
        failed = True

    if failed:
        fail()


def check_functions(commit_range: str) -> None:
    """Function/class declarations lost. False-positive guarded for rename."""
    start, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        ext = Path(f).suffix.lower()
        if ext not in ('.ts', '.tsx', '.js', '.mjs', '.py', '.jsx'):
            continue

        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")
        if old is None or new is None:
            continue

        old_decls: set[str] = set()
        new_decls: set[str] = set()
        old_decl_lines: dict[str, int] = {}

        for pat in FUNC_PATTERNS:
            for m in pat.finditer(old or ""):
                name = m.group(1).strip()
                if name:
                    old_decls.add(name)
                    line_num = old[:m.start()].count("\n") + 1
                    if name not in old_decl_lines:
                        old_decl_lines[name] = line_num
            for m in pat.finditer(new or ""):
                name = m.group(1).strip()
                if name:
                    new_decls.add(name)

        if ext == '.py':
            py_pat = re.compile(r'^\s*(?:async\s+)?def\s+(\w+)\s*\(', re.MULTILINE)
            for m in py_pat.finditer(old or ""):
                name = m.group(1).strip()
                if name:
                    old_decls.add(name)
                    line_num = old[:m.start()].count("\n") + 1
                    if name not in old_decl_lines:
                        old_decl_lines[name] = line_num
            for m in py_pat.finditer(new or ""):
                name = m.group(1).strip()
                if name:
                    new_decls.add(name)

        added = new_decls - old_decls
        lost = old_decls - new_decls

        if not lost:
            continue

        # FP guard 1 — wholesale rename. If added declarations roughly match
        # lost, the diff is a rename (e.g. `alpha` → `alphaNew`) rather than
        # corruption. Triggers at any size.
        if len(added) >= len(lost):
            continue

        # Compute the ratio unconditionally so the emit message below is
        # never reached with `total_old` undefined (S3 has lost=1, target
        # for the single-loss branch below, but the emit message still
        # references total_old).
        total_old = len(old_decls) or 1
        loss_ratio = len(lost) / total_old

        # FP guard 2 — small surgical delete.
        # Single-decl losses always trip (1/300 = 0.33% looks tiny but a
        # missing function is intentional). Multi-decl losses only trip
        # when either the absolute count exceeds MAX or the ratio rises
        # above RATIO. Tiered match against check_exports so S3
        # regressions and S11 thresholds behave consistently.
        if len(lost) > 1 and loss_ratio < FUNC_LOSS_FP_GUARD_RATIO \
                and len(lost) <= FUNC_LOSS_FP_GUARD_MAX:
            continue

        # Build detailed output with line numbers.
        lost_sorted = sorted(lost, key=lambda n: old_decl_lines.get(n, 0))
        with_lines = [
            f"{name} (was near line {old_decl_lines.get(name, '?')})"
            if name in old_decl_lines else name
            for name in lost_sorted
        ]
        sample = ", ".join(with_lines[:6])
        more = "" if len(with_lines) <= 6 else f" (+{len(with_lines) - 6} more)"
        emit(
            f"ERROR: {f} lost {len(lost)}/{total_old} function/class "
            f"declaration(s): {sample}{more}"
        )
        failed = True

    if failed:
        fail()


def check_truncation(commit_range: str) -> None:
    """Detect code-loss via removed-hunk analysis on unified diff.

    Outputs:
      - file path
      - removed vs added line counts
      - preview of removed content (up to 10 lines per hunk, 5 hunks max)
      - function names caught in removed blocks (with approx line numbers)
    False-positive guard: legit refactors add ~as much as they remove.
    """
    start, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        if Path(f).suffix.lower() in SKIP_EXTENSIONS:
            continue

        diff = git_diff_unified(commit_range, f)
        if not diff:
            continue

        removed_lines = 0
        added_lines = 0
        # `current_removed_count` tracks ALL removed lines (including comments)
        # so the displayed hunk line-range is accurate. `removed_lines`
        # tracks only actionable (non-comment / non-import) removals; that
        # count drives the threshold + summary message.
        removed_hunks: list[tuple[int, int, list[str]]] = []  # (start_line, count, preview)
        current_hunk_start = 0
        current_removed_count = 0
        current_preview: list[str] = []
        # Sign-transition counter — counts `-` → `+` (or + → −) transitions
        # across the whole diff. Reset at hunk boundaries so two separate
        # hunks (one pure-add, one pure-delete) don't falsely look interleaved.
        sign_transitions = 0
        prev_sign: str | None = None

        for line in diff.splitlines():
            hdr_match = re.match(
                r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line
            )
            if hdr_match:
                if current_removed_count > 0 and current_preview:
                    removed_hunks.append((
                        current_hunk_start,
                        current_removed_count,
                        current_preview,
                    ))
                current_hunk_start = int(hdr_match.group(1))
                current_removed_count = 0
                current_preview = []
                prev_sign = None  # reset on hunk boundary
                continue

            current_sign: str | None = None
            if line.startswith('-') and not line.startswith('---'):
                current_sign = '-'
            elif line.startswith('+') and not line.startswith('+++'):
                current_sign = '+'

            if current_sign is not None:
                if prev_sign is not None and current_sign != prev_sign:
                    sign_transitions += 1
                prev_sign = current_sign

            if current_sign == '-':
                # Track ALL removed lines for accurate hunk line-range.
                current_removed_count += 1
                # Only count actionable (non-comment/import/blank) removed
                # lines toward the threshold check + summary message.
                if not _is_ignorable_line(line[1:]):
                    removed_lines += 1
                    if len(current_preview) < 10:
                        current_preview.append(line)
            elif current_sign == '+':
                added_lines += 1

        # Flush last hunk.
        if current_removed_count > 0 and current_preview:
            removed_hunks.append((
                current_hunk_start,
                current_removed_count,
                current_preview,
            ))

        if removed_lines == 0:
            continue

        # FP guard 1 (NEW): heavily-interleaved diff is a real rewrite, not
        # blind truncation. Many `+ ↔ -` transitions means the human/LLM
        # rewrote the section interleave-by-interleave rather than clipping
        # out a contiguous chunk. Caught even when line-count ratios are
        # otherwise alarming.
        if sign_transitions >= HUNK_INTERLEAVE_TRANSITIONS_MIN:
            continue

        # FP guard 2: legit refactor — added ~as much as removed, file survived.
        old_content = git_show(f"{start}:{f}")
        new_content = git_show(f"{end}:{f}")
        if old_content and new_content:
            old_len = len(old_content)
            new_len = len(new_content)
            added_ok = added_lines > removed_lines * TRUNCATION_REFACTOR_ADDED_FRACTION
            survived_ok = new_len > old_len * TRUNCATION_REFACTOR_SIZE_FRACTION
            if added_ok and survived_ok:
                continue

        # Skip small diffs — likely surgical, not truncation.
        if removed_lines < TRUNCATION_MIN_REMOVED_LINES:
            continue

        # ---- Report ----
        net_loss = removed_lines - added_lines
        emit(
            f"ERROR: {f}: {removed_lines} lines REMOVED, {added_lines} ADDED "
            f"(net loss: {net_loss} lines; old={len(old_content or '')} chars, "
            f"new={len(new_content or '')} chars)"
        )

        # Removed block previews (up to 5 hunks for readability).
        emit_block("Removed blocks (showing first 5):", [])
        for hunk_start, hunk_count, preview in removed_hunks[:5]:
            end_line = hunk_start + hunk_count - 1
            emit(f"  Block: source lines {hunk_start}-{end_line} ({hunk_count} lines removed)")
            for pline in preview:
                emit(f"    {pline}")
        if len(removed_hunks) > 5:
            emit(f"  ... and {len(removed_hunks) - 5} more removed blocks (not shown)")

        # Functions caught in removed blocks.
        if old_content:
            old_lines = old_content.splitlines()
            caught: list[tuple[str, int]] = []
            seen: set[str] = set()
            for hunk_start, _, _ in removed_hunks:
                for offset in range(-3, 4):
                    idx = hunk_start - 1 + offset
                    if 0 <= idx < len(old_lines):
                        for pat in FUNC_PATTERNS:
                            m = pat.search(old_lines[idx])
                            if m and m.group(1).strip():
                                n = m.group(1).strip()
                                if n not in seen:
                                    seen.add(n)
                                    caught.append((n, hunk_start + offset))
            if caught:
                preview_list = [
                    f"{name} (near line {ln})" for name, ln in caught[:10]
                ]
                more = "" if len(caught) <= 10 else f" (+{len(caught) - 10} more)"
                emit(
                    f"  Functions caught in removed blocks: "
                    f"{', '.join(preview_list)}{more}"
                )

        failed = True

    if failed:
        fail()


def check_syntax(commit_range: str) -> None:
    """Run per-file syntax checks (tsc / node --check / py_compile)."""
    _, end = get_commit_range(commit_range)
    failed = False

    for f in git_diff_names(commit_range):
        ext = Path(f).suffix.lower()
        if ext not in EXT_SYNTAX_CHECK:
            continue

        try:
            new_content = subprocess.check_output(
                ["git", "show", f"{end}:{f}"],
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            continue

        try:
            with tempfile.NamedTemporaryFile(
                prefix='integrity-check-', suffix=ext, delete=False,
            ) as tf:
                tf.write(new_content)
                tmpfile = tf.name

            cmd_template = EXT_SYNTAX_CHECK[ext]
            cmd = [arg.replace('{file}', tmpfile) for arg in cmd_template]
            try:
                result = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=30,
                )
            except subprocess.TimeoutExpired:
                emit(f"WARN: {f} syntax check timed out")
                continue

            if result.returncode != 0:
                # ts messages are noisy; truncate and surface top error only.
                err_lines = (result.stderr or result.stdout or '').strip().splitlines()
                top = err_lines[0] if err_lines else "(no error message)"
                emit(f"ERROR: {f} has syntax errors: {top}")
                failed = True
        except Exception:
            pass
        finally:
            try:
                if tmpfile:
                    os.unlink(tmpfile)
            except OSError:
                pass

    if failed:
        fail()


def check_each_commit(commit_range: str) -> None:
    """Run structural checks on every individual commit in the range.

    Range comparison alone misses truncation that was introduced and later
    fixed within the same push range. Running per-commit catches that.
    """
    if ".." in commit_range:
        base, tip = commit_range.split("..", 1)
    else:
        base = f"{commit_range}^"
        tip = commit_range

    all_shas = (_git("rev-list", f"{base}..{tip}") or "").strip().splitlines()
    if not all_shas:
        return

    any_failed = False
    for sha in all_shas:
        # Skip root commit.
        if not _git("rev-parse", f"{sha}^"):
            continue

        single_range = f"{sha}^..{sha}"
        if not git_diff_names(single_range):
            continue

        for mode_name, fn in [
            ("check-shrinkage", check_shrinkage),
            ("check-braces", check_braces),
            ("check-exports", check_exports),
            ("check-functions", check_functions),
            ("check-truncation", check_truncation),
        ]:
            try:
                fn(single_range)
            except SystemExit as e:
                if e.code != 0:
                    emit(f"  (failed in commit {sha[:7]} via {mode_name})")
                    any_failed = True

    if any_failed:
        fail()


# ===========================================================================
# CLI dispatch
# ===========================================================================

_MODES = {
    'check-shrinkage': check_shrinkage,
    'check-exports': check_exports,
    'check-syntax': check_syntax,
    'check-braces': check_braces,
    'check-functions': check_functions,
    'check-truncation': check_truncation,
    'check-each-commit': check_each_commit,
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Detect truncated, corrupted, or regressed files from "
                    "bad LLM edits before push."
    )
    parser.add_argument(
        '--mode', required=False,
        choices=list(_MODES.keys()) + ['list'],
        help="Detection mode to run. 'list' prints all available modes.",
    )
    parser.add_argument('--range', required=False, help="Git commit range (e.g. a..b)")
    args = parser.parse_args()

    if args.mode == 'list' or args.mode is None:
        emit("Available modes:")
        for m in _MODES:
            emit(f"  - {m}")
        flush()
        return

    if not args.range:
        emit("ERROR: --range is required when --mode is set")
        fail()

    fn = _MODES[args.mode]
    try:
        fn(args.range)
    except SystemExit:
        raise  # already handled by fail() / atexit flush
    except Exception as e:
        emit(f"INTERNAL ERROR during {args.mode}: {e}")
        fail()

    # Successful path — emit summary line so operator sees we ran cleanly.
    emit(f"OK: {args.mode} on {args.range} \u2014 no issues detected.")
    flush()


if __name__ == '__main__':
    main()
