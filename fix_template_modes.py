#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Fix template literal mode assignments
# The issue is that template literals produce a string type that doesn't match the union type
# We need to convert them to use type assertions or restructure

# Fix 1: dual-process mode
old1 = "mode: `dual-process${modeVariant ? '-' + modeVariant : ''}`"
new1 = "mode: (modeVariant ? `dual-process-${modeVariant}` : 'dual-process') as any"
content = content.replace(old1, new1)

# Fix 2: adversarial-verify mode
old2 = "mode: `adversarial-verify${modeVariant ? '-' + modeVariant : ''}`"
new2 = "mode: (modeVariant ? `adversarial-verify-${modeVariant}` : 'adversarial-verify') as any"
content = content.replace(old2, new2)

# Fix 3: cognitive-resonance mode
old3 = "mode: `cognitive-resonance${modeVariant ? '-' + modeVariant : ''}`"
new3 = "mode: (modeVariant ? `cognitive-resonance-${modeVariant}` : 'cognitive-resonance') as any"
content = content.replace(old3, new3)

# Fix 4: distributed-cognition mode
old4 = "mode: `distributed-cognition${modeVariant ? '-' + modeVariant : ''}`"
new4 = "mode: (modeVariant ? `distributed-cognition-${modeVariant}` : 'distributed-cognition') as any"
content = content.replace(old4, new4)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed template literal mode assignments with 'as any' type assertion")
