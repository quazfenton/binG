#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

fixed_lines = []
for line in lines:
    # Replace 'task:' with 'userMessage:' only when it's a property in an object
    # Pattern: start of line (with spaces) followed by 'task:'
    if 'task:' in line and ('request.task' in line or '`[SPEC_' in line or 'specResult' in line or 'currentResponse' in line):
        line = line.replace('task:', 'userMessage:', 1)
    fixed_lines.append(line.rstrip('\n'))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write('\n'.join(fixed_lines))

print("Fixed all 'task:' -> 'userMessage:' in processUnifiedAgentRequest calls")
