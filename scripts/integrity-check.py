#!/usr/bin/env python3
"""
Integrity checks for git commit ranges.
Detects file shrinkage, lost exports, syntax errors from bad LLM edits.
"""

import subprocess
import sys
import json
import os
import argparse
import re
from pathlib import Path


def fail():
    """Flush stdout/stderr before exit to ensure all output is visible."""
    sys.stdout.flush()
    sys.stderr.flush()
    sys.exit(1)

EXT_SYNTAX_CHECK = {
    '.ts': 'npx tsc --noEmit --pretty false',
    '.tsx': 'npx tsc --noEmit --pretty false',
    '.js': 'node --check',
    '.mjs': 'node --check',
    '.py': 'python3 -c "import py_compile; py_compile.compile(\'{file}\', doraise=True)"',
}

EXPORT_PATTERNS = [
    re.compile(r'^\s*export\s+(default\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)', re.MULTILINE),
    re.compile(r'^\s*export\s+\{([^}]+)\}', re.MULTILINE),
    re.compile(r'^\s*(def|class)\s+(\w+)', re.MULTILINE),  # Python
]

IMPORT_PATTERNS = [
    re.compile(r'^\s*import\s+.*from\s+[\'"](\.\.?\/)', re.MULTILINE),
    re.compile(r'^\s*from\s+([\'"]\.\.?\/)', re.MULTILINE),  # Python
]

DUPLICATE_BLOCK_THRESHOLD = 6
DUPLICATE_BLOCK_MIN_LEN = 50

# How many lines of a removed diff hunk to show as preview
TRUNCATION_PREVIEW_LINES = 10

# Brace pairs for structural balance check
BRACE_PAIRS = [
    ('curly brace', '{', '}'),
    ('parenthesis', '(', ')'),
    ('square bracket', '[', ']'),
]

# Function/method/class declaration patterns
FUNC_PATTERNS = [
    re.compile(r'(?:^|\s)(?:async\s+)?function\s+(\w+)\s*\(', re.MULTILINE),
    re.compile(r'(?:^|\s)(?:export\s+)?(?:default\s+)?class\s+(\w+)', re.MULTILINE),
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(', re.MULTILINE),
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function', re.MULTILINE),
    re.compile(r'^\s*(?:public|private|protected|static)?\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*[{:]', re.MULTILINE),
    re.compile(r'(\w+)\s*[=:]\s*(?:async\s+)?\([^)]*\)\s*(?::\s*\w+)?\s*=>\s*[{\(]', re.MULTILINE),
]

# Track line numbers for lost declarations (populated by check_functions)
LOST_DECL_LINES = {}  # file -> [(name, approx_line)]


def git_diff_unified(commit_range, file_path):
    """Get unified diff for a single file in a commit range."""
    try:
        out = subprocess.check_output(
            ["git", "diff", "-U5", commit_range, "--", file_path],
            stderr=subprocess.DEVNULL,
        ).decode(errors="replace")
        return out
    except subprocess.CalledProcessError:
        return None


def get_commit_range(commit_range):
    if '..' in commit_range:
        return commit_range.split('..', 1)
    else:
        return [f"{commit_range}^", commit_range]


def git_show(ref_path):
    try:
        return subprocess.check_output(
            ["git", "show", ref_path],
            stderr=subprocess.DEVNULL,
        ).decode(errors="ignore")
    except subprocess.CalledProcessError:
        return None


def git_diff_names(commit_range):
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", commit_range],
            stderr=subprocess.DEVNULL,
        ).decode()
        return [f for f in out.splitlines() if f.strip()]
    except subprocess.CalledProcessError:
        return []


def check_shrinkage(commit_range):
    start, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False

    for f in files:
        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")

        if old is None or new is None:
            continue

        old_len = len(old)
        new_len = len(new)

        if old_len > 500 and new_len > 0:
            ratio = new_len / old_len
            if ratio < 0.5:
                print(f"ERROR: {f} shrank to {ratio:.1%} of original size ({old_len} → {new_len} chars).")
                failed = True
            elif ratio < 0.7:
                print(f"WARN: {f} shrank to {ratio:.1%} of original size ({old_len} → {new_len} chars).")

    if failed:
        fail()


def check_exports(commit_range):
    start, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False

    for f in files:
        ext = Path(f).suffix.lower()
        if ext not in ('.ts', '.tsx', '.js', '.mjs', '.py'):
            continue

        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")

        if old is None or new is None:
            continue

        old_exports = set()
        new_exports = set()

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
        if lost:
            print(f"ERROR: {f} lost exports: {', '.join(sorted(lost))}")
            failed = True

    if failed:
        fail()


def check_syntax(commit_range):
    _, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False

    syntax_checkable = []
    for f in files:
        ext = Path(f).suffix.lower()
        if ext in EXT_SYNTAX_CHECK:
            syntax_checkable.append(f)

    if not syntax_checkable:
        return

    for f in syntax_checkable:
        ext = Path(f).suffix.lower()
        cmd_template = EXT_SYNTAX_CHECK[ext]

        try:
            new_content = subprocess.check_output(
                ["git", "show", f"{end}:{f}"],
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            continue

        tmpfile = f"/tmp/integrity-check-{os.getpid()}{ext}"
        try:
            with open(tmpfile, 'wb') as fh:
                fh.write(new_content)

            cmd = cmd_template.replace('{file}', tmpfile)
            result = subprocess.run(
                cmd, shell=True,
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                stderr_short = (result.stderr or result.stdout or '')[:300]
                print(f"ERROR: {f} has syntax errors: {stderr_short}")
                failed = True
        except subprocess.TimeoutExpired:
            print(f"WARN: {f} syntax check timed out")
        except Exception:
            pass
        finally:
            try:
                os.unlink(tmpfile)
            except OSError:
                pass

    if failed:
        fail()


def check_braces(commit_range):
    """
    Detect unbalanced braces/parens/brackets introduced in a commit range.
    Flags cases where old content had balanced pairs but new content does not
    — a strong indicator of accidental truncation.
    Requires the imbalance to exceed a small threshold (5) to avoid false
    positives from braces inside strings/comments.
    """
    start, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False

    for f in files:
        ext = Path(f).suffix.lower()
        if ext in ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
                   '.woff2', '.woff', '.ttf', '.eot', '.mp4', '.mp3',
                   '.webp', '.zip', '.tar', '.gz', '.lock', '.map', '.br',
                   '.heapsnapshot'):
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

            if old_balanced and not new_balanced and imbalance > 5:
                print(
                    f"ERROR: {f} has unbalanced {pair_name}s "
                    f"({new_open} opening vs {new_close} closing, "
                    f"imbalance={imbalance}). "
                    f"Was balanced in parent commit."
                )
                failed = True

    if failed:
        fail()


def check_functions(commit_range):
    """
    Detect removed function/method/class declarations in a commit range.
    Broader than check-exports — catches non-exported symbols too.
    Uses ratio heuristics to avoid false positives for intentional refactors.
    """
    global LOST_DECL_LINES
    start, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False
    LOST_DECL_LINES = {}

    for f in files:
        ext = Path(f).suffix.lower()
        if ext not in ('.ts', '.tsx', '.js', '.mjs', '.py', '.jsx'):
            continue

        old = git_show(f"{start}:{f}")
        new = git_show(f"{end}:{f}")

        if old is None or new is None:
            continue

        old_decls = set()
        new_decls = set()
        old_decl_lines = {}  # name -> approx line number in old content

        for pat in FUNC_PATTERNS:
            for m in pat.finditer(old or ""):
                name = m.group(1).strip()
                if name:
                    old_decls.add(name)
                    # Track approximate line number via string counting
                    line_num = old[:m.start()].count('\n') + 1
                    if name not in old_decl_lines:
                        old_decl_lines[name] = line_num
            for m in pat.finditer(new or ""):
                name = m.group(1).strip()
                if name:
                    new_decls.add(name)

        # Python: def/class patterns
        if ext == '.py':
            py_pat = re.compile(r'^\s*(?:async\s+)?def\s+(\w+)\s*\(', re.MULTILINE)
            for m in py_pat.finditer(old or ""):
                name = m.group(1).strip()
                if name:
                    old_decls.add(name)
                    line_num = old[:m.start()].count('\n') + 1
                    if name not in old_decl_lines:
                        old_decl_lines[name] = line_num
            for m in py_pat.finditer(new or ""):
                name = m.group(1).strip()
                if name:
                    new_decls.add(name)

        # Count newly-added declarations (suggest rename, not loss)
        added = new_decls - old_decls

        lost = old_decls - new_decls
        if not lost:
            continue

        # False-positive guard: skip if similar number of new decls added
        # (likely a rename/refactor, not corruption)
        if len(lost) <= 3 and len(added) >= len(lost):
            continue

        # False-positive guard: skip if only a tiny fraction of declarations lost
        total_old = len(old_decls) or 1
        loss_ratio = len(lost) / total_old
        if len(lost) <= 3 and loss_ratio < 0.15:
            continue

        # Build detailed output with line numbers
        lost_sorted = sorted(lost, key=lambda n: old_decl_lines.get(n, 0))
        with_lines = []
        for name in lost_sorted:
            ln = old_decl_lines.get(name)
            if ln:
                with_lines.append(f"{name} (was near line {ln})")
            else:
                with_lines.append(name)

        print(
            f"ERROR: {f} lost {len(lost)}/{total_old} declaration(s): "
            f"{', '.join(with_lines)}"
        )
        LOST_DECL_LINES[f] = list(zip(lost_sorted, [old_decl_lines.get(n, 0) for n in lost_sorted]))
        failed = True

    if failed:
        fail()


def check_truncation(commit_range):
    """Detect code truncation by analyzing git diff removed hunks."""
    with open("/tmp/fd2_check.log", "a") as _f:
        _f.write(f"function entered\n")

    # Try os.write(2, ...) directly
    try:
        os.write(2, b"FUNC_START via os.write(2)\n")
        with open("/tmp/fd2_check.log", "a") as _f:
            _f.write("os.write(2) succeeded\n")
    except OSError as _e:
        with open("/tmp/fd2_check.log", "a") as _f:
            _f.write(f"os.write(2) error: {_e}\n")

    # Try os.write(1, ...) directly
    try:
        os.write(1, b"FUNC_START via os.write(1)\n")
        with open("/tmp/fd2_check.log", "a") as _f:
            _f.write("os.write(1) succeeded\n")
    except OSError as _e:
        with open("/tmp/fd2_check.log", "a") as _f:
            _f.write(f"os.write(1) error: {_e}\n")

    # Try subprocess
    import subprocess as _sp
    _sp.check_call(["python3", "-c", "import sys; sys.stderr.write('FUNC_START via subprocess\\n'); sys.stderr.flush()"])

    start, end = get_commit_range(commit_range)
    files = git_diff_names(commit_range)
    failed = False

    for f in files:
        ext = Path(f).suffix.lower()
        if ext in ('.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
                   '.woff2', '.woff', '.ttf', '.eot', '.mp4', '.mp3',
                   '.webp', '.zip', '.tar', '.gz', '.lock', '.map', '.br',
                   '.heapsnapshot'):
            continue

        diff = git_diff_unified(commit_range, f)
        if not diff:
            continue

        removed_lines = 0
        added_lines = 0
        removed_hunks = []
        current_hunk_start = 0
        current_removed_count = 0
        current_preview = []

        for line in diff.splitlines():
            hdr_match = re.match(
                r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line
            )
            if hdr_match:
                if current_removed_count > 0 and current_preview:
                    removed_hunks.append((
                        current_hunk_start,
                        current_removed_count,
                        current_preview[:TRUNCATION_PREVIEW_LINES],
                    ))
                current_hunk_start = int(hdr_match.group(1))
                current_removed_count = 0
                current_preview = []
                continue

            if line.startswith('-') and not line.startswith('---'):
                removed_lines += 1
                current_removed_count += 1
                if len(current_preview) < TRUNCATION_PREVIEW_LINES:
                    current_preview.append(line)
            elif line.startswith('+') and not line.startswith('+++'):
                added_lines += 1

        if current_removed_count > 0 and current_preview:
            removed_hunks.append((
                current_hunk_start,
                current_removed_count,
                current_preview[:TRUNCATION_PREVIEW_LINES],
            ))

        if removed_lines == 0:
            continue

        old_content = git_show(f"{start}:{f}")
        new_content = git_show(f"{end}:{f}")
        if old_content and new_content:
            old_len = len(old_content)
            new_len = len(new_content)
            if added_lines > removed_lines * 0.3 and new_len > old_len * 0.5:
                continue

        if removed_lines < 50:
            continue

        _sb = lambda s: subprocess.check_call(
            ["python3", "-c",
             "import sys; sys.stderr.write({}); sys.stderr.flush()".format(
                 repr(s + "\n"))]
        )

        _sb(
            f"ERROR: {f}: {removed_lines} lines removed, {added_lines} added "
            f"(net loss: {removed_lines - added_lines} lines)"
        )

        os.write(2, b"  [OS_WRITE_AFTER_SB]\n")
        print("  [PRINT_AFTER_SB]", flush=True)

        for hunk_start, hunk_count, preview in removed_hunks[:5]:
            end_line = hunk_start + hunk_count - 1
            _sb(f"  Removed block: lines {hunk_start}-{end_line} "
                f"({hunk_count} lines)")
            for pline in preview:
                _sb(f"    {pline}")
        if len(removed_hunks) > 5:
            _sb(f"  ... and {len(removed_hunks) - 5} more removed blocks")

        if old_content:
            old_lines = old_content.splitlines()
            removed_funcs = []
            for hunk_start, _, _ in removed_hunks:
                for offset in range(-3, 3):
                    idx = hunk_start - 1 + offset
                    if 0 <= idx < len(old_lines):
                        for pat in FUNC_PATTERNS:
                            m = pat.search(old_lines[idx])
                            if m and m.group(1).strip():
                                removed_funcs.append((m.group(1).strip(), hunk_start + offset))
            if removed_funcs:
                seen = set()
                func_list = []
                for name, ln in removed_funcs:
                    if name not in seen:
                        seen.add(name)
                        func_list.append(f"{name} (near line {ln})")
                if func_list:
                    _sb(f"  Functions caught in removed blocks: "
                        f"{', '.join(func_list[:10])}")
                    if len(func_list) > 10:
                        _sb(f"    ... and {len(func_list) - 10} more")

        failed = True

    if failed:
        fail()


def check_each_commit(commit_range):
    """
    Run all structural checks (shrinkage, braces, exports, functions)
    on every individual commit in the range — catches truncation that
    was later fixed by a subsequent commit in the same push.
    """
    if '..' in commit_range:
        base, tip = commit_range.split('..', 1)
    else:
        base = f"{commit_range}^"
        tip = commit_range

    all_commits = subprocess.check_output(
        ["git", "rev-list", f"{base}..{tip}"],
        stderr=subprocess.DEVNULL,
    ).decode().strip().splitlines()

    if not all_commits:
        return

    any_failed = False
    for sha in all_commits:
        single_range = f"{sha}^..{sha}"
        # Skip root commit
        try:
            subprocess.check_call(
                ["git", "rev-parse", f"{sha}^"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            continue

        changed = git_diff_names(single_range)
        if not changed:
            continue

        for mode, fn in [
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
                    print(f"  (in commit {sha})")
                    any_failed = True

    if any_failed:
        fail()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=[
        'check-shrinkage', 'check-exports', 'check-syntax',
        'check-braces', 'check-functions', 'check-truncation',
        'check-each-commit',
    ])
    parser.add_argument('--range', required=True)
    parser.add_argument('--baseline', default='/opt/bing/scripts/integrity-baseline.json')
    args = parser.parse_args()

    if args.mode == 'check-shrinkage':
        check_shrinkage(args.range)
    elif args.mode == 'check-exports':
        check_exports(args.range)
    elif args.mode == 'check-syntax':
        check_syntax(args.range)
    elif args.mode == 'check-braces':
        check_braces(args.range)
    elif args.mode == 'check-functions':
        check_functions(args.range)
    elif args.mode == 'check-truncation':
        check_truncation(args.range)
    elif args.mode == 'check-each-commit':
        check_each_commit(args.range)
