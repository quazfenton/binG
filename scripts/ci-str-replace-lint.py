#!/usr/bin/env python3
"""
NEW-CI-1 (2026-07-08) — ci-str-replace-lint.py: pre-flight oldString-presence
check for any future `str_replace` invocation. Extracted from §10.3 of
/opt/bing/docs/str-replace-resilience.md so it can be invoked from CI /
pre-commit / standalone basher calls with stable exit codes.

Verifies an oldString is present in the target file's raw bytes BEFORE any
attempted str_replace. Catches content-drift + em-dash/encoding issues on
the FIRST attempt, replacing the "2 str_replace attempts" rule with a
deterministic one-shot check.

Usage:
    ./ci-str-replace-lint.py <file> <oldString>
    # Note: use single-quotes around <oldString> to preserve em-dashes +
    # tab characters in the shell.

Exit codes:
    0  = FOUND        (safe to str_replace; an advisory line is appended if
                       em-dash density exceeds the §9.1 flagged-list threshold)
    1  = NOT FOUND    (use Python heredoc bypass — see §3 of
                       /opt/bing/docs/str-replace-resilience.md)
    2  = BAD ARGS / FILE NOT FOUND

Examples:
    # Match found (safe to str_replace):
    $ ./ci-str-replace-lint.py token-refresh.ts 'await Promise.allSettled('
    FOUND at line 271 (matches: 1, em-dashes in file: 2)

    # Match not-found (use Python heredoc bypass):
    $ ./ci-str-replace-lint.py vercel-ai-streaming.ts \\
            'const { normalizeToolArgs } = await import'
    NOT FOUND (127 em-dashes in file) — use Python heredoc bypass
"""
import argparse
import sys

# §9.1 flagged-list thresholds (mirror of §10.2 D-section).
EM_DASH_BYTES = b'\xe2\x80\x94'  # UTF-8 —
EM_DASH_ABSOLUTE_THRESHOLD = 30
DENSITY_THRESHOLD = 0.02


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            'Pre-flight oldString-presence check for str_replace '
            '(see §10 of docs/str-replace-resilience.md).'
        )
    )
    parser.add_argument('file', help='target file path')
    parser.add_argument(
        'oldstring',
        metavar='oldString',
        help='oldString to look up; escape with single quotes in shell',
    )
    args = parser.parse_args()

    try:
        with open(args.file, 'rb') as f:
            raw = f.read()
    except FileNotFoundError:
        print(f'ERROR: {args.file} not found', file=sys.stderr)
        return 2

    needle = args.oldstring.encode('utf-8')
    idx = raw.find(needle)
    em_count = raw.count(EM_DASH_BYTES)
    lines = raw.count(b'\n')

    if idx >= 0:
        line = raw[:idx].count(b'\n') + 1
        matches = raw.count(needle)
        advisory = ''
        if em_count >= EM_DASH_ABSOLUTE_THRESHOLD and lines > 0:
            density = em_count / lines
            if density >= DENSITY_THRESHOLD:
                advisory = (
                    f' [ADVISORY: {em_count} em-dashes over {lines} lines '
                    f'(density {density:.4f}/line) — exceeds §9.1 '
                    'flagged-list threshold]'
                )
        print(
            f'FOUND at line {line} (matches: {matches}, '
            f'em-dashes in file: {em_count}){advisory}'
        )
        return 0

    print(
        f'NOT FOUND ({em_count} em-dashes in file) — use Python heredoc bypass'
    )
    return 1


if __name__ == '__main__':
    sys.exit(main())
