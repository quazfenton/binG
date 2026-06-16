#!/usr/bin/env python3
# scripts/check-polish-overedits.py
#
# Lint rule that flags candidate "polish over-edits" in staged git diffs.
# An over-edit is suspect when the newString widens the diff by more than
# DELTA_SE_THRESHOLD sentence boundaries (`.` `?` `!`) beyond the
# oldString, OR when |Δpunct| exceeds DELTA_PUNCT_THRESHOLD, suggesting
# the agent rephrased more than was necessary.
#
# The user's framing (verbatim): "str_replace's oldString is found but the
# newString widens the diff by > 1 sentence boundary or punctuation
# change, so over-edits are caught before commit".
#
# Tightening vs prior version (per code review):
#   - Substitution-only: only flag when both old_lines and new_lines are
#     non-empty. Pure additions and pure deletions are NOT flagged (the
#     user's framing implies "oldString is found", which means substitution).
#   - Punctuation drift threshold lowered from 4 to 2 (more sensitive to
#     subtle polishi-style comma/semicolon shifts).
#   - Ellipsis (`...`) is stripped to a single `.` before sentence-end
#     counting so it doesn't inflate delta_se by +3.
#   - Default file extensions broadened to include `.json .mjs .yml .yaml`
#     since config files are routine polish targets.
#
# Usage
#   check-polish-overedits.py [extensions...]
#     extensions filter the staged diff (default: .ts .tsx .js .jsx .md
#     .json .mjs .yml .yaml)
#
# Exit codes
#   0  no warnings emitted across all hunks
#   1  warnings emitted (review signal; the git-hooks/pre-commit treats
#      non-zero as a hard block — pass --warn-only to override)
#   2  git / configuration error

from __future__ import annotations

import argparse
import re
import subprocess
import sys

# Sentence-end punctuation — count these in old/new to detect "widening
# across sentence boundaries". A polish over-edit is one where the new
# block introduces MORE sentence boundaries than the old block.
# NOTE: regular strings (not raw) so `\u…` escapes are interpreted as
# Unicode codepoints — `\u3002` is the CJK period, `\uFF1F` is the
# fullwidth question mark, etc.
SENT_END_RE = re.compile("[.!?\u3002\uFF1F\uFF01]")

# Ellipsis patterns: three+ dots/question/exclamation marks in a row.
# We strip these BEFORE counting sentence-end chars, so `...` counts as
# ONE sentence boundary instead of three.
ELLIPSIS_DOT_RE = re.compile(r"\.{3,}")
ELLIPSIS_OTHER_RE = re.compile(r"([!?\u3002\uFF1F\uFF01])\1{2,}")

# Punctuation chars that can drift between old and new strings. We count
# the ABSOLUTE cardinality delta (`|new - old|`), since the user said
# "or punctuation change" without further magnitude.
# NOTE: regular strings (not raw) so `\u…` escapes are interpreted as
# Unicode codepoints (smart quotes `\u201c-\u201d` etc.).
PUNCT_RE = re.compile(
    "["
    ",;:"
    "(){}[]"
    '"\u201c\u201d\u2018\u2019'
    "\u2014\u2013\u2010\u2011-"
    "`_~"
    "]"
)

DEFAULT_SE_THRESHOLD = 1
DEFAULT_PUNCT_THRESHOLD = 2  # tightened from 4 per review
# IMPORTANT: pathspecs must be GLOBS — bare ".ts" matches NO files in
# git's pathspec syntax. Without the leading `*`, `git diff --cached
# -- .ts` returns empty, which made the script silently a no-op.
DEFAULT_EXTENSIONS = [
    "*.ts", "*.tsx", "*.js", "*.jsx", "*.md",
    "*.json", "*.mjs", "*.yml", "*.yaml",
]


def normalize_for_count(text: str) -> str:
    """Strip ellipses before sentence-end counting so `...` counts as 1."""
    text = ELLIPSIS_DOT_RE.sub(".", text)
    text = ELLIPSIS_OTHER_RE.sub(r"\1", text)
    return text


def get_staged_diff(extensions: list[str]) -> str:
    """Run `git diff --cached -U0 -- <extensions>` and return stdout.
    Uses `--no-pager` to avoid pager interference when called from a
    non-TTY subprocess context."""
    cmd = ["git", "--no-pager", "diff", "--cached", "-U0"]
    if extensions:
        cmd += ["--"] + extensions
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
    except subprocess.CalledProcessError as exc:
        sys.stderr.write(
            f"check-polish-overedits: git diff failed (exit {exc.returncode})\n"
            + exc.output.decode("utf-8", "replace")
        )
        sys.exit(2)
    return out.decode("utf-8", "replace")


def parse_hunks(diff_text: str):
    """Yield per-hunk: (file, old_lines, new_lines) where each is a list
    of lines WITHOUT the leading +/-/space marker."""
    current_file: str | None = None
    old_lines: list[str] = []
    new_lines: list[str] = []
    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            if current_file and (old_lines or new_lines):
                yield current_file, old_lines, new_lines
            parts = line.split()
            if len(parts) >= 4:
                current_file = parts[-1]
                if current_file.startswith("b/"):
                    current_file = current_file[2:]
            else:
                current_file = None
            old_lines, new_lines = [], []
            continue
        if line.startswith(("--- ", "+++ ", "index ", "new file", "deleted file", "rename ", "Binary ", "@@")):
            continue
        if line.startswith("-"):
            old_lines.append(line[1:])
        elif line.startswith("+"):
            new_lines.append(line[1:])
        elif line.startswith(" "):
            old_lines.append(line[1:])
            new_lines.append(line[1:])
    if current_file and (old_lines or new_lines):
        yield current_file, old_lines, new_lines


def check_hunk(
    old_lines: list[str],
    new_lines: list[str],
    se_threshold: int,
    punct_threshold: int,
):
    """Return flag list (and stats tuple). Empty if no flag.
    Returns ([flag, ...], (old_se, new_se, old_p, new_p)).

    SUBSTITUTION-ONLY GUARD: a hunk with empty old_lines (pure addition)
    or empty new_lines (pure deletion) is NOT flagged. The user's spec
    says "oldString is found but the newString widens", which implies
    both old and new content are present in the diff.
    """
    if not old_lines or not new_lines:
        return [], (0, 0, 0, 0)
    old_text = normalize_for_count("\n".join(old_lines))
    new_text = normalize_for_count("\n".join(new_lines))
    if old_text == new_text:
        return [], (0, 0, 0, 0)
    old_se = len(SENT_END_RE.findall(old_text))
    new_se = len(SENT_END_RE.findall(new_text))
    delta_se = new_se - old_se
    old_punct = len(PUNCT_RE.findall(old_text))
    new_punct = len(PUNCT_RE.findall(new_text))
    delta_punct = abs(new_punct - old_punct)
    flags: list[str] = []
    if delta_se > se_threshold:
        flags.append(
            f"Δsentence-ends={delta_se} (old={old_se} new={new_se}; widen > "
            f"{se_threshold} → polish over-edit across sentence boundary)"
        )
    if delta_punct > punct_threshold:
        flags.append(
            f"|Δpunct|={delta_punct} (old={old_punct} new={new_punct}; "
            f"threshold > {punct_threshold} → punctuation drift)"
        )
    return flags, (old_se, new_se, old_punct, new_punct)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Lint staged git diffs for polish over-edits."
    )
    parser.add_argument(
        "extensions",
        nargs="*",
        default=DEFAULT_EXTENSIONS,
        help="File extensions to lint (default: .ts .tsx .js .jsx .md .json .mjs .yml .yaml)",
    )
    parser.add_argument(
        "--warn-only",
        action="store_true",
        help="Print warnings but exit 0 (do not block commits).",
    )
    parser.add_argument(
        "--se-threshold",
        type=int,
        default=DEFAULT_SE_THRESHOLD,
        help=f"Sentence-end delta threshold (default {DEFAULT_SE_THRESHOLD})",
    )
    parser.add_argument(
        "--punct-threshold",
        type=int,
        default=DEFAULT_PUNCT_THRESHOLD,
        help=f"Punctuation delta threshold (default {DEFAULT_PUNCT_THRESHOLD})",
    )
    args = parser.parse_args()

    diff_text = get_staged_diff(args.extensions)
    warn_count = 0
    hunk_count = 0
    for file, old_lines, new_lines in parse_hunks(diff_text):
        if not (old_lines or new_lines):
            continue
        hunk_count += 1
        flags, _stats = check_hunk(
            old_lines,
            new_lines,
            args.se_threshold,
            args.punct_threshold,
        )
        if not flags:
            continue
        warn_count += 1
        sys.stdout.write(f"\033[33m[POLISH-OVEREDIT]\033[0m {file}\n")
        for f in flags:
            sys.stdout.write(f"  -> {f}\n")

    if warn_count == 0:
        return 0
    sys.stdout.write(
        f"\n[POLISH-OVEREDIT] {warn_count}/{hunk_count} hunks flagged; "
        "review before commit.\n"
    )
    return 0 if args.warn_only else 1


if __name__ == "__main__":
    sys.exit(main())
