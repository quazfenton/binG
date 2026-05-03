#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# We need to fix indentation inside the switch statement
# case should be at 6 spaces, content at 8 spaces, comments at 6 spaces
# The orphaned cases start after line ~972 (after agent-team break)

in_switch = False
in_case = False
brace_depth = 0
fixed_lines = []

for i, line in enumerate(lines):
    stripped = line.rstrip('\n')
    
    # Detect switch
    if 'switch (mode)' in stripped:
        in_switch = True
        fixed_lines.append(line.rstrip('\n'))
        continue
    
    if not in_switch:
        fixed_lines.append(line.rstrip('\n'))
        continue
    
    # Count braces to track switch depth
    open_braces = stripped.count('{')
    close_braces = stripped.count('}')
    brace_depth += open_braces - close_braces
    
    # Check if we're leaving the switch
    if brace_depth < 0:
        in_switch = False
        fixed_lines.append(line.rstrip('\n'))
        continue
    
    # Inside switch - fix indentation
    # case/default at 6 spaces
    if re.match(r'^\s*(case\s|default\s*:)', stripped):
        # Fix to exactly 6 spaces
        content = stripped.lstrip()
        fixed_lines.append('      ' + content)
        in_case = True
        continue
    
    # Comments that are section headers (with ===)
    if '// ===' in stripped:
        content = stripped.lstrip()
        fixed_lines.append('      ' + content)
        continue
    
    # Regular comments inside switch but outside case
    if re.match(r'^\s*//', stripped) and not in_case:
        content = stripped.lstrip()
        fixed_lines.append('      ' + content)
        continue
    
    # Content inside case (after case ... {)
    if in_case and stripped.strip():
        # Check if this is the closing brace of the case
        if stripped.strip() == '}':
            fixed_lines.append('      }')
            in_case = False
        else:
            # Content inside case - 8 spaces
            content = stripped.lstrip()
            fixed_lines.append('        ' + content)
        continue
    
    # Empty lines
    if not stripped.strip():
        fixed_lines.append('')
        continue
    
    # Default case
    fixed_lines.append(line.rstrip('\n'))

# Write back
with open(filepath, 'w', encoding='utf-8') as f:
    f.write('\n'.join(fixed_lines))

print("Fixed indentation of switch cases")
