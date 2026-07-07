#!/usr/bin/env python3
"""Delete the leftover private classifyResponseShape helper + ResponseShape
type alias that the earlier consolidation pass failed to remove. The private
function is still at line ~560 in /opt/bing/web/lib/orchestra/unified-agent-
service.ts while the structured-helper-call imports were applied — so the
file has two helpers and TS resolves calls to the private 2-arg version,
causing TS2554.

Surgical fix: locate the helper block via the unique signature line
'function classifyResponseShape(' (which appears only once now in the file
after I removed the prior deletion attempt) plus the type alias above it,
and delete through to the closing brace + blank line.

If there are now TWO matches for that line (private helper still there + a
new one from any other path), we report and bail.
"""

import sys
import re

PATH = '/opt/bing/web/lib/orchestra/unified-agent-service.ts'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# Find all occurrences of the helper signature line
sig_pattern = re.compile(r'^function classifyResponseShape\($', re.MULTILINE)
matches = list(sig_pattern.finditer(content))

# Filter to occurrences OUTSIDE the structured call sites (those are
# `const ... = classifyResponseShape({` for both sites). Only module-level
# `function classifyResponseShape(` declarations match.
decl_matches = [
    m for m in matches
    if 'function classifyResponseShape(' in content[m.start():m.start() + 256]
    and re.match(r'  function classifyResponseShape\(', content[max(0, m.start()-2):m.start()])
]
# Simpler: any `function classifyResponseShape(` at indentation <= 2 spaces
decl_matches = [
    m for m in matches
    # preceding character must be whitespace, not '='
    and (m.start() == 0 or content[m.start() - 1] in ' \t\n')
]

print(f'Found {len(matches)} raw matches for "function classifyResponseShape("')

if len(matches) == 0:
    print('[FAIL] no private helper signature found — already deleted?')
    sys.exit(1)

if len(matches) > 1:
    print('[FAIL] multiple matches — investigate manually')
    for m in matches:
        print(f'  match at {m.start()}: {repr(content[m.start():m.start() + 80])}')
    sys.exit(1)

# Found exactly one match.
match = matches[0]
print(f'Single match at byte {match.start()}')

# Walk back to find the start of the comment block (or type alias line) that
# immediately precedes the function. We expect a `/**` doc comment OR the
# `type ResponseShape = ...` line directly.
helper_start = None

# Walk back to find the start of the **immediately preceding** JSDoc comment.
j = match.start()
# Walk back through whitespace, then either find '/**' (start of JSDoc) or
# 'type ResponseShape =' (start of type alias).
while j > 0:
    # Look for either marker anywhere in windowed backward passes
    window = content[max(0, j - 600):j]
    # JSDoc comment ends at '*/'
    end_doc_idx = window.rfind('*/')
    if end_doc_idx >= 0:
        # Find matching '/**' backwards in same window
        start_doc_idx = window.rfind('/**', 0, end_doc_idx)
        if start_doc_idx >= 0:
            # Verify nothing structural between '/**' end and 'function' line
            abs_start = max(0, j - 600) + start_doc_idx
            pre = content[abs_start:match.start()]
            if 'function classifyResponseShape(' in pre or 'type ResponseShape' in pre:
                # Check no other 'function ' between abs_start and match.start
                intervening_funcs = re.findall(r'^\w*function\s', content[abs_start:match.start()], re.MULTILINE)
                intervening_types = re.findall(r'^type\s+\w+\s*=', content[abs_start:match.start()], re.MULTILINE)
                if len(intervening_funcs) == 1 and len(intervening_types) <= 1:
                    helper_start = abs_start
                    break
    # 'type ResponseShape' without leading JSDoc
    type_idx = window.rfind('type ResponseShape')
    if type_idx >= 0:
        abs_start = max(0, j - 600) + type_idx
        # Walk back to beginning of line
        line_start = abs_start
        while line_start > 0 and content[line_start - 1] != '\n':
            line_start -= 1
        helper_start = line_start
        break
    j = max(0, j - 600)

if helper_start is None:
    print('[FAIL] could not locate the start of the helper block by walking back.')
    print('Showing 800 chars before the function:')
    print(repr(content[max(0, match.start() - 800):match.start() + 200]))
    sys.exit(1)

# Walk forward from match.start() to find the closing `}` of the function.
# Easiest: count balanced braces from `function classifyResponseShape(` block.
# We know this is a simple function: signature + body with if statements, no nested functions.
fn_start = match.start()
brace_depth = 0
i = fn_start
in_string = None
fn_end = None
found_open = False
while i < len(content):
    ch = content[i]
    if in_string:
        if ch == '\\':
            i += 2
            continue
        if ch == in_string:
            in_string = None
        i += 1
        continue
    if ch in ('"', "'", '`'):
        in_string = ch
        i += 1
        continue
    if ch == '{':
        brace_depth += 1
        found_open = True
    elif ch == '}':
        brace_depth -= 1
        if found_open and brace_depth == 0:
            fn_end = i + 1
            break
    i += 1

if fn_end is None:
    print('[FAIL] could not find closing brace of helper function.')
    sys.exit(1)

# Walk past trailing newline if present
if fn_end < len(content) and content[fn_end] == '\n':
    fn_end += 1
# Consume a single trailing blank line (so we don't leave two blank lines)
if fn_end < len(content) - 1 and content[fn_end] == '\n' and content[fn_end - 1] == '\n':
    fn_end += 0  # leave one blank line for separation
# Actually we want exactly ONE trailing newline after the previous content.
# If there's already a blank line after the function, leave it. Otherwise add one.
# Compute the extra newline accounting: end.prevnewline = content[fn_end-1]
prev = content[fn_end - 1] if fn_end > 0 else '\n'
extra = '\n' if prev != '\n' and content[fn_end] != '\n' else ''

# Just delete through fn_end; this preserves what was before/after.
to_delete = content[helper_start:fn_end]
print(f'Deleting bytes {helper_start}..{fn_end} (length {len(to_delete)}).')
print('First 400 chars of to_delete:')
print(repr(to_delete[:400]))
print('Last 200 chars of to_delete:')
print(repr(to_delete[-200:]))

new_content = content[:helper_start] + content[fn_end:]
# Trim multiple blank lines around the deletion: collapse 3+ consecutive \n into 2
new_content = re.sub(r'\n{3,}', '\n\n', new_content)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(new_content)

# Verify deletion
with open(PATH, 'r', encoding='utf-8') as f:
    verify = f.read()
remaining = sig_pattern.findall(verify)
print(f'\nRemaining private helper signatures: {len(remaining)} (expected 0)')
if remaining:
    for sig in remaining[:3]:
        print(f'  STRAY: {sig!r}')
    sys.exit(1)

print('=== DELETION SUCCESS ===')
print(f'Bytes deleted: {len(to_delete)}')
print(f'File size: {len(content)} -> {len(new_content)} (delta {len(new_content) - len(content):+d})')
