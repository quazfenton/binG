#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

lines = content.split('\n')
print(f"Total lines: {len(lines)}")

# Find key line numbers (0-indexed)
switch_open = None
switch_close = None
default_case = None
return_result = None
orphan_start = None
orphan_end = None
try_catch = None

for i, line in enumerate(lines):
    if line == '    switch (mode) {':
        switch_open = i
    if switch_open is not None and line == '    }' and switch_close is None:
        switch_close = i
    if '// FALLBACK - Should never reach here' in line:
        default_case = i
    if line == '    return result;':
        return_result = i
    if return_result is not None and '// V1-API MODE' in line and orphan_start is None:
        orphan_start = i
    if orphan_start is not None and line.strip() == '} catch (error: any) {':
        try_catch = i
        break

orphan_end = try_catch - 2  # before the catch block

print(f"switch_open: {switch_open}, line: {lines[switch_open] if switch_open else None}")
print(f"switch_close: {switch_close}, line: {lines[switch_close] if switch_close else None}")
print(f"default_case: {default_case}, line: {lines[default_case] if default_case else None}")
print(f"return_result: {return_result}, line: {lines[return_result] if return_result else None}")
print(f"orphan_start: {orphan_start}, line: {lines[orphan_start] if orphan_start else None}")
print(f"orphan_end: {orphan_end}, line: {lines[orphan_end] if orphan_end else None}")
print(f"try_catch: {try_catch}, line: {lines[try_catch] if try_catch else None}")

# Extract orphaned cases
orphaned = lines[orphan_start:orphan_end+1]
print(f"\nOrphaned cases: {len(orphaned)} lines")

# Now build the new file:
# 1. Lines from start to return_result (inclusive)
# 2. Lines from try_catch to end
# But we also need to insert orphaned cases into the switch (before default_case)

# First, let's create the main content without orphaned cases
main_content = lines[:return_result+1] + lines[try_catch:]

# Find where to insert in main_content (before default_case)
# Need to find the new position of default_case in main_content
default_in_main = None
for i, line in enumerate(main_content):
    if '// FALLBACK - Should never reach here' in line:
        default_in_main = i
        break

# Find the break; before default case
insert_pos = None
for i in range(default_in_main - 1, -1, -1):
    if main_content[i].strip() == 'break;':
        insert_pos = i + 1
        break

print(f"\nInsert position in main_content: {insert_pos}")
print(f"default_in_main: {default_in_main}")

# Fix indentation of orphaned cases
# case should be at 6 spaces, content at 8 spaces
fixed_orphaned = []
for line in orphaned:
    stripped = line.strip()
    if not stripped or stripped.startswith('// ==='):
        fixed_orphaned.append('      ' + stripped)
    elif stripped.startswith('case ') or stripped == 'default:' or stripped in ('{', '}'):
        fixed_orphaned.append('      ' + stripped)
    else:
        fixed_orphaned.append('        ' + stripped)

# Insert into main_content
new_content = main_content[:insert_pos] + [''] + fixed_orphaned + [''] + main_content[insert_pos:]

# Write back
with open(filepath, 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_content))

print("\nDone! Orphaned cases moved into switch with correct indentation.")
