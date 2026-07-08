# `str_replace` Resilience Note

**Created**: 2026-07-08
**Triggering incident**: 4 byte-verified `str_replace` attempts on
`/opt/bing/web/lib/chat/vercel-ai-streaming.ts` (single-line, multi-line, top-of-file)
all returned "not found" — bypassed with a Python heredoc that succeeded.

---

## TL;DR — When `str_replace` fails twice on the same file, switch to the
**Python heredoc** bypass described in §3. Do not burn more than 2 attempts
on `str_replace` per file. Most failures are **content drift**, not encoding
or tool bugs.

---

## 1. Failure pattern (what you see)

```
str_replace(oldString=...)  → "The old string ... was not found in the file,
                              skipping. ... No change to the file"
```

This is the **only** error you get — the tool gives no diagnostic info about
**why** the match failed. The `oldString` was either:

- (a) **content-drifted** from the actual file bytes (most common — see §2)
- (b) encoding-mismatched (rare — see §4)
- (c) partial-overlap (rare — see §4)

You cannot distinguish (a) from (b) from the error message alone. The diagnostic
test in §2 tells you which one.

---

## 2. Root cause (why it happens)

**Primary cause: `oldString` content drift.** When the LLM constructs
`oldString` from memory, prior context, or a previously-read file snapshot,
the bytes often don't match the current file. Common drift sources:

| Drift type | Example | Detection |
| --- | --- | --- |
| **Wrong destructuring** | expected `const { normalizeToolArgs } = await import`; actual `const { normalizeToolArgs: fbNormalize } = await import(...)` | `grep -n` the leading prefix |
| **Wrong import path** | expected `import { StreamingTextResponse }`; file uses `streamText` (no `StreamingTextResponse` exists) | `grep -n` the import name |
| **Em-dash / smart-quote drift** | expected `—` (U+2014) in a comment; LLM normalizes to `-` when re-emitting | `od -c` the suspect line |
| **Cite drift** | line numbers shifted due to prior edits in the same file | `grep -n` the function/class/section header |
| **Trailing whitespace** | the file has `Foo   \n`; oldString has `Foo\n` | `cat -A` the suspect line |
| **Wrong section** | oldString from a *different* function/method in the same file | `grep -nE` the unique substring |

**Why the failing file is especially vulnerable:**
`/opt/bing/web/lib/chat/vercel-ai-streaming.ts` contains **127 em-dashes (U+2014)**,
**7 en-dashes (U+2013)**, and **5 ellipsis (U+2026)** in its comments — a 12x
higher em-dash density than the typical working file (working control file had
only 11 em-dashes). Em-dashes are 3-byte UTF-8 (`\xe2\x80\x94`) and are
frequently normalized to hyphens by LLM tokenizers, file readers, or
intermediate tool layers. Once normalized, the re-emitted `oldString` is byte-
different from the file, and `str_replace` correctly reports "not found".

**Secondary cause (rare): encoding artifacts.** The diagnostic test below will
catch these — they were ruled out in the incident file (no BOM, no CRLF, no
NUL, no NFC/NFD drift, no zero-width chars, no soft hyphens).

---

## 3. Bypass recipe (Python heredoc)

When `str_replace` has failed twice on the same file, switch to this recipe.
It guarantees byte-precise OLD/NEW matching by reading the actual file bytes
first.

### 3.1. Backup

```bash
cp /opt/bing/web/lib/<path>/<file>.ts /tmp/<file>.ts.PRE-APPLY-<ticket>.bak
md5sum /tmp/<file>.ts.PRE-APPLY-<ticket>.bak
```

### 3.2. Read the EXACT bytes (no LLM paraphrasing)

```bash
# Show lines with line numbers, using awk + L#### prefix to preserve bytes verbatim
awk 'NR>=2860 && NR<=2900 {printf "L%04d[%s]\n", NR, $0}' \
    /opt/bing/web/lib/<path>/<file>.ts
```

**Do NOT trust any prior reading of the file.** The file may have shifted due
to other agents' edits. Re-read with `awk` for every new `oldString`.

### 3.3. Apply via Python heredoc

```python
import hashlib
import os

FILE = '/opt/bing/web/lib/<path>/<file>.ts'

with open(FILE, 'r', encoding='utf-8') as f:
    content = f.read()

original_lines = content.count('\n')
original_md5 = hashlib.md5(content.encode('utf-8')).hexdigest()
print(f"START: {original_lines} lines, md5={original_md5}")

# Construct OLD/NEW from the EXACT awk output above.
# Use raw triple-quoted strings to preserve indentation + special chars.
SITE_OLD = """<exact bytes from awk>"""

SITE_NEW = """<exact new bytes>"""

if SITE_OLD not in content:
    raise SystemExit(f"FATAL: SITE_OLD not found in {FILE} — aborting")

if content.count(SITE_OLD) != 1:
    raise SystemExit(f"FATAL: SITE_OLD matches {content.count(SITE_OLD)} times — disambiguate")

new_content = content.replace(SITE_OLD, SITE_NEW, 1)

# Atomic write: write to .tmp, then rename
TMP = FILE + '.tmp'
with open(TMP, 'w', encoding='utf-8') as f:
    f.write(new_content)
os.replace(TMP, FILE)

# Verify
with open(FILE, 'r', encoding='utf-8') as f:
    written = f.read()
new_lines = written.count('\n')
new_md5 = hashlib.md5(written.encode('utf-8')).hexdigest()
print(f"END:   {new_lines} lines, md5={new_md5}")
print(f"delta: {new_lines - original_lines} lines")
assert new_md5 != original_md5, "FATAL: file unchanged after write"
assert SITE_NEW in written, "FATAL: SITE_NEW not in written file"
assert SITE_OLD not in written, "FATAL: SITE_OLD still in written file"
print("OK")
```

### 3.4. Verify (mandatory)

```bash
# 1. tsc clean
cd /opt/bing/web && ./node_modules/.bin/tsc --noEmit --skipLibCheck

# 2. Brace count over the apply region (one-liner awk to avoid bash quoting pitfalls)
sed -n '<start>,<end>p' <file> | awk '{n_open+=gsub(/\{/,"{"); n_close+=gsub(/\}/,"}"); if (NR==1) delta=0; delta=(n_open-n_close)} END{print "open="n_open, "close="n_close, "delta="n_open-n_close}'
# delta should be 0 ONLY if the region is a complete balanced block.
# If the region is partial, expect delta != 0 — that's normal.
# The authoritative check is tsc, not the brace count.

# 3. Spawn code-reviewer-minimax-m3 to review the diff
```

### 3.5. If the apply needs a LARGER OLD or multi-site edits

If a small `oldString` doesn't match but a *larger* one (extending past the
intended target) does, that's a sign the surrounding context has drifted too.
**Re-read more lines with `awk`** and use a larger OLD/NEW that includes
all drifted neighbors.

For multi-site edits in one file, apply each site as a separate `content.replace(SITE_OLD_n, SITE_NEW_n, 1)`
in the same Python script, with `assert` checks between each.

---

## 4. Diagnostic test (run when in doubt)

If you have time before falling back to Python, run this 30-second test to
characterize the failure:

```bash
F=/opt/bing/web/lib/<path>/<file>.ts

# A. file-level properties
ls -la "$F" && file "$F" && md5sum "$F" && wc -lc "$F"

# B. encoding / BOM / line endings
head -c 16 "$F" | od -An -tx1     # first 16 bytes — should NOT start with EF BB BF (BOM)
echo "CRLF: $(grep -c $'\r' "$F")"   # should be 0
echo "NUL:  $(LC_ALL=C grep -c $'\x00' "$F")"   # should be 0
echo "TAB:  $(grep -c $'\t' "$F")"   # TS files should be 0
echo "trailing-ws: $(grep -cE ' +$' "$F")"

# C. control-char scan
md5sum "$F"
LC_ALL=C tr -d '\0-\10\13\14\16-\37' < "$F" | md5sum
# If these differ, control chars exist — likely culprit

# D. Unicode-char census (key chars that cause drift)
for PATTERN in '\xE2\x80\x9C' '\xE2\x80\x9D' '\xE2\x80\x98' '\xE2\x80\x99' \
               '\xE2\x80\x94' '\xE2\x80\x93' '\xE2\x80\xA6' \
               '\xC2\xA0' '\xE2\x80\x8B' '\xEF\xBB\xBF' '\xC2\xAD'; do
    COUNT=$(LC_ALL=C grep -cP "$PATTERN" "$F" 2>/dev/null || echo 0)
    echo "  $PATTERN: $COUNT"
done
# High em-dash / en-dash / ellipsis count → drift is more likely

# E. in-memory Python match (definitive)
python3 << PYEOF
with open("$F", 'rb') as f:
    raw = f.read()
needle = b'<your oldString verbatim>'
print(f"oldString in raw bytes: {needle in raw}")
idx = raw.find(needle)
if idx >= 0:
    print(f"  found at byte offset {idx}, line {raw[:idx].count(b'\\n')+1}")
else:
    print(f"  NOT FOUND. File has {raw.count(chr(0x2014).encode())} em-dashes — check those.")
PYEOF
```

**Interpretation:**
- `oldString in raw bytes: True` → not a content-drift issue; the tool itself
  has a bug or your call is malformed (e.g., the tool is normalizing internally)
- `oldString in raw bytes: False` → content drift; use Python heredoc bypass

---

## 5. Decision flow

```
str_replace returns "not found"
  │
  ├── Have you tried a single-line, multi-line, and top-of-file oldString?
  │     NO  → try those three patterns first
  │     YES ↓
  │
  ├── Run the §4 diagnostic test (30 sec)
  │     │
  │     ├── oldString in raw bytes: True   → tool bug, file the issue
  │     │
  │     └── oldString in raw bytes: False  → content drift (likely cause)
  │           │
  │           └── Switch to §3 Python heredoc bypass
  │
  └── Re-apply with byte-fresh OLD/NEW (read with awk, not memory)
```

---

## 6. Common pitfalls (what NOT to do)

1. **Don't paraphrase `oldString` from memory or from a prior LLM context.**
   Re-read the file with `awk` for every new `oldString`.

2. **Don't trust line-number cites from prior agents or prior turns.** They
   drift. Re-`grep -n` the leading prefix of the target region.

3. **Don't re-emit em-dashes from a comment block via the LLM.** LLMs
   sometimes normalize em-dashes to hyphens, ASCII arrows, or even strip them.
   Copy them byte-exact from the `awk` output.

4. **Don't use `sed -i` directly on a 4000+ line TS file.** `sed` has no
   awareness of TypeScript syntax; a malformed regex can break the file silently.
   Use the Python heredoc for atomicity and assert checks.

5. **Don't apply the heredoc without a backup.** Always `cp` to
   `/tmp/<file>.ts.PRE-APPLY-<ticket>.bak` first.

6. **Don't skip the `assert SITE_OLD not in written` check.** A common
   failure mode is the heredoc applying a *partial* match (e.g., if `SITE_OLD`
   appears 2x in the file, the assert catches it before tsc does).

---

## 7. Incident report (2026-07-08)

**File**: `/opt/bing/web/lib/chat/vercel-ai-streaming.ts` (4070 lines, 186KB)

**Attempts (all returned "not found"):**
1. 19-line `oldString` containing smart-quotes + em-dashes + Unicode arrows
2. 2-line `oldString` `const { normalizeToolArgs } = await import` + next line
3. Single-line `oldString` `// Bug #5 fix: Also record 429 in the per-provider circuit breaker`
4. Single-line `oldString` `import { StreamingTextResponse` at top of file

**Root cause**: All 4 `oldString`s were content-drifted from the file's
actual bytes. Specifically:
- Attempt 1: em-dash count in the comment block did not match the file's 127 em-dashes
- Attempt 2: actual line is `const { normalizeToolArgs: fbNormalize } = await import('@/lib/orchestra/shared-agent-context')` — different destructuring + different module
- Attempt 3: line is at L3274, not at the expected location (cite drift)
- Attempt 4: file does not use `StreamingTextResponse` at all (uses `streamText`)

**Diagnostic ruling-out**: File IS clean UTF-8, no BOM, no CRLF, no NUL, no
control chars, no NFC/NFD decomposition drift, no zero-width chars. The
`str_replace` tool is working correctly — it was reporting "not found" honestly.

**Bypass that worked**: Python heredoc with `awk`-extracted `oldString` for
Site A + Site B. First apply round had a brace-balance bug (NEW opened
`if (validateToolArgs) {` without closing → TS1005/TS1472 at L2945/L3039).
Corrected via restore-from-backup + LARGER Site A `oldString` extending
through L2930 + re-indent +2 spaces + atomic re-write. Final `tsc` clean.

**Lesson**: This file has unusually high em-dash density (127 in 4070 lines)
— comment blocks here are *especially* vulnerable to LLM-normalization drift.
Future agents working on this file should default to the Python heredoc
bypass without trying `str_replace` first.

---

## 8. Quick-reference (TL;DR for fast agents)

```bash
# 1. If str_replace fails twice, run this:

cp /opt/bing/web/lib/<path>/<file>.ts /tmp/<file>.ts.PRE-APPLY-<TICKET>.bak
md5sum /tmp/<file>.ts.PRE-APPLY-<TICKET>.bak

# 2. Read exact bytes:
awk 'NR>=<START> && NR<=<END> {printf "L%04d[%s]\n", NR, $0}' \
    /opt/bing/web/lib/<path>/<file>.ts

# 3. Apply via Python heredoc (recipe in §3.3) with assert checks

# 4. Verify:
cd /opt/bing/web && ./node_modules/.bin/tsc --noEmit --skipLibCheck
```

**Heuristic**: 1 em-dash per ~32 lines is the file-wide mean. A file with
>1 em-dash per ~10 lines (like `vercel-ai-streaming.ts`) is high-risk for
`oldString` drift. Use the Python bypass by default on such files.
