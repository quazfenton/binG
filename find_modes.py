#!/usr/bin/env python3
import re

with open('packages/shared/agent/modula.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# Find all mode assignments (both string literals and template literals)
pattern = r'mode:\s*(?:[\'`][^\'`]*[\'`])'
matches = re.findall(pattern, content)
print(f"Found {len(matches)} mode assignments:")
for i, m in enumerate(matches[:20]):
    print(f"  {i}: {m}")
