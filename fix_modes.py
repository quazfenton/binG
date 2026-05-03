#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find all mode assignments with template literals
# Pattern: mode: `something${...}`
pattern = r"mode:\s*`[^`]*\$\{[^}]+\}[^`]*`"
matches = re.findall(pattern, content)
print(f"Found {len(matches)} template literal mode assignments:")
for m in matches[:10]:
    print(f"  {m}")

# Fix the template literals to use string literals instead
# The issue is that `dual-process${modeVariant ? '-' + modeVariant : ''}`
# produces a type of `dual-process${string}` which doesn't match the union type

# Let's fix each case:

# 1. dual-process cases
content = re.sub(
    r"mode:\s*`dual-process\$\{modeVariant \? '-' \+ modeVariant : ''\}`",
    "mode: modeVariant ? `dual-process-${modeVariant}` : 'dual-process'",
    content
)

# 2. adversarial-verify cases  
content = re.sub(
    r"mode:\s*`adversarial-verify\$\{modeVariant \? '-' \+ modeVariant : ''\}`",
    "mode: modeVariant ? `adversarial-verify-${modeVariant}` : 'adversarial-verify'",
    content
)

# 3. cognitive-resonance cases
content = re.sub(
    r"mode:\s*`cognitive-resonance\$\{modeVariant \? '-' \+ modeVariant : ''\}`",
    "mode: modeVariant ? `cognitive-resonance-${modeVariant}` : 'cognitive-resonance'",
    content
)

# 4. distributed-cognition cases
content = re.sub(
    r"mode:\s*`distributed-cognition\$\{modeVariant \? '-' \+ modeVariant : ''\}`",
    "mode: modeVariant ? `distributed-cognition-${modeVariant}` : 'distributed-cognition'",
    content
)

# 5. spec:super and spec:maximal - fix the mode assignments
# For spec:super, mode should be 'v1-api'
content = re.sub(
    r"mode:\s*'spec:super'",
    "mode: 'v1-api'",
    content
)

# For spec:maximal, mode should be 'v1-agent-loop' for the middle step
# Actually looking at the code, spec:maximal uses 'v1-api' and 'v1-agent-loop'
# Let's check the context...

# Write back
with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("\nFixed template literal mode assignments")
