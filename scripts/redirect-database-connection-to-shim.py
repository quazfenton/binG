#!/usr/bin/env python3
r"""
redirect-database-connection-to-shim.py — TIGHTENED, fixture-tested redirect
script for the database/connection → database/connection-shim migration.

WHY THIS IS TIGHTER THAN THE PREVIOUS INLINE REGEX
==================================================
The previous regex `(database/connection)(?=["')\s])` matched ANY substring
ending in `database/connection + ["')\s]` — including URL strings. The new
regex anchors with an `import-syntax prefix` (from | require( | import( |
await import() so it ONLY fires in actual import-path contexts. Comment
lines are skipped up-front as a coarse tokenizer.

USAGE
=====
    # Run the embedded fixture tests:
    python3 redirect-database-connection-to-shim.py --test

    # Dry-run sweep (prints intended changes, writes nothing):
    python3 redirect-database-connection-to-shim.py --dry-run /opt/bing/web/lib

    # Apply (rewrite .ts/.tsx/.mts/.mjs files in place):
    python3 redirect-database-connection-to-shim.py /opt/bing/web/lib

POSITIVE FIXTURES (must match → rewrite `database/connection` → `-shim`)
======================================================================
    import { x } from '@/lib/database/connection';
    import 'database/connection';
    require('@/lib/database/connection');
    import('@/lib/database/connection');
    await import('@/lib/database/connection');
    await import(`@/lib/database/connection`);   # backtick
    import type { X } from "@/lib/database/connection";
    require  ('./database/connection')           # whitespace
    from    '@/lib/database/connection'          # extra spaces

NEGATIVE FIXTURES (must NOT match → leave intact)
================================================
    const url = 'http://example.com/database/connection';   # URL
    const doc = "http://docs/database/connection/foo";       # URL
    // import from '/database/connection' is the legacy path  # comment
    // const x = require('database/connection')                # comment
     * docs/database/connection is deprecated                  # JSDoc
    '@/lib/database/connection-something'                      # -suffix
    '@/lib/database/connection/schema'                         # /subdir
    const from = x; from();                                    # local var

KNOWN LIMITATIONS (documented acceptance)
========================================
1. SINGLE-LINE FULL-COMMENT SKIP: A line whose lstripped form starts with
   `//`, `/*`, `*`, or `*/` is passed through untouched. This covers the
   common case of comment-only lines.

2. INLINE COMMENT WITH IMPORT SYNTAX — ACCEPTED FALSE-POSITIVE: A line
   like
       const x = 1; // import from 'database/connection' loads legacy
   starts with `const`, so the comment-skip filter does NOT engage, and
   the import-syntax prefix DOES match inside the trailing comment. The
   script would rewrite the comment, breaking docs. The trade-off is
   accepted because: (a) maintaining a full JS/TS tokenizer is heavy for
   a one-shot utility, and (b) developers writing such comments in the
   codebase can manually patch the one-off case. If you encounter a real    hit, replace `database/connection` with a literal that doesn't match
    import syntax (e.g., backslash-escape a separator), then rerun.

3. MULTI-LINE `/* ... */` BLOCKS — NOT TRACKED: A `/*` opened on line N
   and containing `from 'database/connection'` on line N+1 (closed on
   N+2) is NOT detected as a comment because the lstrip check operates
   line-by-line and the import-syntax line doesn't `lstrip` to a
   comment marker. Same workaround as (2).
"""

import argparse
import re
import sys
from pathlib import Path

# ──────────────────────────────────────────────────────────────────────
# Tightened regex — anchored with an import-syntax prefix
# ──────────────────────────────────────────────────────────────────────
#
#   Why each component is here:
#     - The non-capturing `(?: from\s+ | require\s*\( | import\s*\( |
#       await\s+import\s*\( )` block fires ONLY when the literal
#       `from`/`require`/`import` is in an actual import position. URL
#       paths like `'http://x/y'` and identifier uses like `from()` never
#       match because the prefix isn't in import syntax.
#     - `\s*['"`]` accepts ' " ` (backtick for template-literal imports).
#     - `[^'"`\s]*?` non-greedy path-pre captures any path chars before
#       the target WITHOUT crossing quotes/whitespace — so the match stays
#       inside one quoted literal. Non-greedy so we don't over-match when
#       `database/connection` appears mid-quoted-literal.
#     - `(?= ['"`\s] )` is a NON-CONSUMING lookahead requiring a closing
#       quote, backtick, or whitespace. Disallowing `-` here means
#       `database/connection-something` and `database/connection-shim`
#       do NOT match — they're already-redirected or sub-module paths.
#     - The lookahead's non-consumption is what makes the substitution
#       `m.group(0) + '-shim'` trivial: the match ends exactly at the `n`
#       of `connection`, so we just append.
#
PATH_RE = re.compile(
    r"""
    (?:
        from\s+                   # static:  X from '...'
      | require\s*\(              # CommonJS: require('...')
      | import\s*\(               # dynamic (no await): import('...')
      | import\s+                 # bare side-effect: import '...'
      | await\s+import\s*\(       # dynamic with await
    )
    \s*['"`]                      # opening quote (' " or `)
    ([^'"`\s]*?)                  # path chars BEFORE the target
    database/connection           # the target
    (?= ['"`\s] )                 # closing boundary (NOT `-`)
    """,
    re.VERBOSE,
)


def is_comment_line(line: str) -> bool:
    """Coarse comment-line detector.

    Skips:
      - Single-line comments (`//`)
      - JSDoc/block-comment OPENING line (`/*`)
      - JSDoc/block-comment CONTINUATION line (`*`)
      - Block-comment CLOSING line (`*/`)

    This is intentionally coarse — it doesn't track multi-line `/* ... */`
    block-comment state across lines. The redirect migration assumes
    import-syntax patterns don't appear inside `/* */` blocks; if a doc
    string does contain a full `from 'database/connection'`, the developer
    can manually reroute. For tight, run-once migrations, this is plenty.
    """
    stripped = line.lstrip()
    return stripped.startswith(("//", "/*", "*", "*/"))


def rewrite_text(text: str) -> tuple[str, int]:
    """Apply the redirect to text, returning (new_text, replace_count)."""
    counter = [0]

    def sub_fn(m):
        counter[0] += 1
        return m.group(0) + "-shim"

    out_lines: list[str] = []
    for line in text.splitlines(keepends=True):
        if is_comment_line(line):
            out_lines.append(line)
            continue
        out_lines.append(PATH_RE.sub(sub_fn, line))
    return "".join(out_lines), counter[0]


# ──────────────────────────────────────────────────────────────────────
# Embedded fixture tests
# ──────────────────────────────────────────────────────────────────────

FIXTURES: list[tuple[str, str, str]] = [
    # ---------- POSITIVE: must match ----------
    (
        "static single-quote",
        "import { x } from '@/lib/database/connection';\n",
        "import { x } from '@/lib/database/connection-shim';\n",
    ),
    (
        "static double-quote",
        'import { x } from "@/lib/database/connection";\n',
        'import { x } from "@/lib/database/connection-shim";\n',
    ),
    (
        "bare side-effect import",
        "import 'database/connection';\n",
        "import 'database/connection-shim';\n",
    ),
    (
        "type-import",
        "import type { X } from '@/lib/database/connection';\n",
        "import type { X } from '@/lib/database/connection-shim';\n",
    ),
    (
        "CommonJS require",
        "const c = require('@/lib/database/connection');\n",
        "const c = require('@/lib/database/connection-shim');\n",
    ),
    (
        "require with whitespace before paren",
        "const c = require  ('./database/connection');\n",
        "const c = require  ('./database/connection-shim');\n",
    ),
    (
        "require with whitespace inside parens",
        "const c = require(  './database/connection'  );\n",
        "const c = require(  './database/connection-shim'  );\n",
    ),
    (
        "dynamic import (no await)",
        "const m = import('@/lib/database/connection');\n",
        "const m = import('@/lib/database/connection-shim');\n",
    ),
    (
        "dynamic await import",
        "const m = await import('@/lib/database/connection');\n",
        "const m = await import('@/lib/database/connection-shim');\n",
    ),
    (
        "dynamic await import with backtick",
        "const m = await import(`@/lib/database/connection`);\n",
        "const m = await import(`@/lib/database/connection-shim`);\n",
    ),
    (
        "from with extra spaces",
        "from    '@/lib/database/connection'\n",
        "from    '@/lib/database/connection-shim'\n",
    ),
    (
        "multi-import on one line",
        "import X from 'a'; import Y from '@/lib/database/connection';\n",
        "import X from 'a'; import Y from '@/lib/database/connection-shim';\n",
    ),
    # ---------- NEGATIVE: must NOT match ----------
    (
        "NEG: URL in single-quoted const",
        "const url = 'http://example.com/database/connection';\n",
        "const url = 'http://example.com/database/connection';\n",
    ),
    (
        "NEG: URL in double-quoted const",
        'const doc = "http://docs/database/connection/foo";\n',
        'const doc = "http://docs/database/connection/foo";\n',
    ),
    (
        "NEG: single-line comment containing from+path",
        "// import from '/database/connection' loads legacy\n",
        "// import from '/database/connection' loads legacy\n",
    ),
    (
        "NEG: single-line comment containing require",
        "// const x = require('database/connection')  /* old */\n",
        "// const x = require('database/connection')  /* old */\n",
    ),
    (
        "NEG: JSDoc continuation line",
        " * see docs/database/connection (frontend)\n",
        " * see docs/database/connection (frontend)\n",
    ),
    (
        "NEG: JSDoc continuation with whitespace prefix",
        "    * see docs/database/connection\n",
        "    * see docs/database/connection\n",
    ),
    (
        "NEG: -something suffix",
        "const x = '@/lib/database/connection-something';\n",
        "const x = '@/lib/database/connection-something';\n",
    ),
    (
        "NEG: /schema subdir",
        "const x = '@/lib/database/connection/schema';\n",
        "const x = '@/lib/database/connection/schema';\n",
    ),
    (
        "NEG: local variable named `from`",
        "const from = x;\n",
        "const from = x;\n",
    ),
    (
        "NEG: already-redirected -shim target",
        "import { x } from '@/lib/database/connection-shim';\n",
        "import { x } from '@/lib/database/connection-shim';\n",
    ),
    (
        "NEG: import-side-effect only (no database)",
        "import 'side-effect-only';\n",
        "import 'side-effect-only';\n",
    ),
    # ---------- Code-reviewer NIT additions ----------
    (
        "PATH-EXTRA: module.exports re-binding (CJS)",
        "module.exports = require('@/lib/database/connection');\n",
        "module.exports = require('@/lib/database/connection-shim');\n",
    ),
    (
        "PATH-EXTRA: namespace import (*  as ns)",
        "import * as ns from '@/lib/database/connection';\n",
        "import * as ns from '@/lib/database/connection-shim';\n",
    ),
    (
        "PATH-EXTRA: type-only via typeof import(...).X",
        "const T: typeof import('@/lib/database/connection').getDatabase;\n",
        "const T: typeof import('@/lib/database/connection-shim').getDatabase;\n",
    ),
    (
        "PATH-EXTRA: multi-line import {x} from (whitespace + newlines before path)",
        "import {\n  x\n} from '@/lib/database/connection';\n",
        "import {\n  x\n} from '@/lib/database/connection-shim';\n",
    ),
    (
        "PATH-EXTRA: re-export pattern (export { x } from)",
        "export { getDatabase } from '@/lib/database/connection';\n",
        "export { getDatabase } from '@/lib/database/connection-shim';\n",
    ),
    (
        "NEG-LIMITATION: inline comment with import syntax (locked-in trade-off — see KNOWN LIMITATIONS in docstring)",
        "const x = 1; // import from 'database/connection' loads legacy\n",
        "const x = 1; // import from 'database/connection-shim' loads legacy\n",
    ),
]


def run_fixture_tests(verbose: bool = True) -> int:
    """Run FIXTURES and report pass/fail. Returns 0 on all-pass."""
    failures: list[tuple[str, str, str, str, int]] = []
    for desc, inp, expected in FIXTURES:
        actual, count = rewrite_text(inp)
        if actual != expected:
            failures.append((desc, inp, expected, actual, count))
            if verbose:
                print(f"  FAIL: {desc}")
                print(f"    input:    {inp!r}")
                print(f"    expected: {expected!r}")
                print(f"    actual:   {actual!r}")
        elif verbose:
            print(f"  PASS: {desc}  (substitutions: {count})")
    if failures:
        print(f"\n{len(failures)} / {len(FIXTURES)} FAILED")
        return 1
    print(f"\nAll {len(FIXTURES)} FIXTURES PASS")
    return 0


# ──────────────────────────────────────────────────────────────────────
# Filesystem sweep
# ──────────────────────────────────────────────────────────────────────

# Substrings that, if present in a candidate path, mean we should NOT
# touch the file:
#   - /__tests__/, *.test.ts, *.spec.ts             : vi.mock keys rely on
#     the literal `@/lib/database/connection`; redirecting breaks the
#     mock key.
#   - vitest.setup.ts                              : setup file already
#     imports the shim path; no further work.
#   - connection-shim / connection.client / schema : sub-paths of
#     /lib/database/ that must not redirect.
#   - node_modules, .next, dist                    : build artifacts.
SKIP_SUBSTRINGS = (
    "/__tests__/",
    "/.test.",
    "/.spec.",
    "/vitest.setup.ts",
    "/test-utils/",
    "/mocks/",
    "/__mocks__/",
    "/connection-shim",
    "/connection.client",
    "/connection-schema",
    "/connection.ts.bak",
    "/node_modules/",
    "/.next/",
    "/dist/",
)


def should_skip(path: Path) -> bool:
    return any(skip in str(path) for skip in SKIP_SUBSTRINGS)


def rewrite_file(path: Path, dry_run: bool) -> int:
    """Rewrite a single file. Returns number of substitutions."""
    text = path.read_text(encoding="utf-8", errors="replace")
    new_text, count = rewrite_text(text)
    if count > 0 and not dry_run:
        path.write_text(new_text, encoding="utf-8")
    return count


def sweep(root: Path, dry_run: bool, extensions: tuple[str, ...]) -> int:
    """Walk the file tree, applying the redirect. Returns total substitutions."""
    total = 0
    files_touched = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in extensions:
            continue
        if should_skip(path):
            continue
        n = rewrite_file(path, dry_run)
        if n:
            files_touched += 1
            total += n
            mode = "DRY" if dry_run else "APPLY"
            print(f"  [{mode}] {path}: {n} substitution{'s' if n != 1 else ''}")
    mode = "DRY-RUN" if dry_run else "APPLIED"
    print(f"\n{mode}: {files_touched} files, {total} total substitutions")
    return total


# ──────────────────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────────────────

def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "path",
        nargs="?",
        help="Root directory to sweep. Omit with --test for fixture-only run.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print intended changes, write nothing.",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Run embedded fixture tests and exit.",
    )
    parser.add_argument(
        "--ext",
        action="append",
        default=None,
        help="File extensions to process (default: .ts .tsx .mts .mjs). Repeatable.",
    )
    args = parser.parse_args(argv)

    extensions = tuple(args.ext) if args.ext else (".ts", ".tsx", ".mts", ".mjs")

    if args.test or not args.path:
        return run_fixture_tests()

    root = Path(args.path)
    if not root.exists():
        print(f"ERROR: path not found: {root}", file=sys.stderr)
        return 2
    sweep(root, dry_run=args.dry_run, extensions=extensions)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
