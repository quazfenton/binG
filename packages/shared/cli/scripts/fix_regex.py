#!/usr/bin/env python3
import re

bin_path = 'bin.ts'

with open(bin_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f'File has {len(lines)} lines')

# Check lines 870-871 (0-indexed: 869-870)
for i in [869, 870]:
    if i < len(lines):
        print(f'Line {i+1}: {repr(lines[i])}')

# Fix line 870 and 871
# The pattern /\/g should be /\\/g (need 2 backslashes in source for 1 in regex)
for i in [869, 870]:
    if i < len(lines) and 'replace(/\\//g' in lines[i]:
        # The line has single backslash which is invalid
        # Need to change /\/g to /\\/g
        old_line = lines[i]
        # Replace the invalid pattern
        # Pattern: /\/g followed by comma (for the first replace)
        # Pattern: /\/+$/ followed by comma (for the second replace)
        
        # Fix: replace(/\//g, '/') should be replace(/\\/g, '/')
        lines[i] = lines[i].replace('replace(/\\//g', 'replace(/\\\\/g')
        # Fix: replace(/\/+$/, '') should be replace(/\\\\+$/, '')
        lines[i] = lines[i].replace('replace(/\\/+', 'replace(/\\\\/+')
        
        print(f'Fixed line {i+1}')
        print(f'New: {repr(lines[i])}')

# Write back
with open(bin_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('File updated')

# Verify
with open(bin_path, 'r', encoding='utf-8') as f:
    new_lines = f.readlines()
print('\\nVerification:')
for i in [869, 870]:
    if i < len(new_lines):
        print(f'Line {i+1}: {new_lines[i].rstrip()}')