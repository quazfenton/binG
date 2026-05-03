#!/usr/bin/env python3

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

fixed_lines = []
in_processUnified = False
brace_depth = 0

for line in lines:
    stripped = line.rstrip('\n')
    
    # Check if we're entering a processUnifiedAgentRequest call
    if 'processUnifiedAgentRequest({' in stripped or 'processUnifiedAgentRequest({' in stripped.replace(' ', ''):
        in_processUnified = True
        brace_depth = 0
    
    if in_processUnified:
        # Count braces
        brace_depth += stripped.count('{') - stripped.count('}')
        
        # Replace ownerId with userId
        if 'ownerId:' in line:
            line = line.replace('ownerId:', 'userId:', 1)
        
        # Replace sessionId with sandboxId  
        if 'sessionId:' in line:
            line = line.replace('sessionId:', 'sandboxId:', 1)
        
        # Check if we're leaving the call
        if brace_depth <= 0 and '});' in stripped:
            in_processUnified = False
    
    fixed_lines.append(line.rstrip('\n'))

with open(filepath, 'w', encoding='utf-8') as f:
    f.write('\n'.join(fixed_lines))

print("Fixed ownerId -> userId and sessionId -> sandboxId in processUnifiedAgentRequest calls")
