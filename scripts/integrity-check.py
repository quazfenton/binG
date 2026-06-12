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
        sys.exit(1)


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
        sys.exit(1)


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
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['check-shrinkage', 'check-exports', 'check-syntax'])
    parser.add_argument('--range', required=True)
    parser.add_argument('--baseline', default='/opt/bing/scripts/integrity-baseline.json')
    args = parser.parse_args()

    if args.mode == 'check-shrinkage':
        check_shrinkage(args.range)
    elif args.mode == 'check-exports':
        check_exports(args.range)
    elif args.mode == 'check-syntax':
        check_syntax(args.range)
