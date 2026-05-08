import re

with open('lib/chat/chat-request-logger.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Fix 1: Merged comment + if statement (line with 'updated      if')
    if 'updated      if' in line:
        # This line has: comment text + 'if (isRateLimitError...'
        # Split into proper comment line + if statement
        new_lines.append('    // This ensures rotation tracking and circuit breaker are updated\n')
        new_lines.append('    if (isRateLimitError && actualProvider && actualModel && actualModel !== \'unknown\') {\n')
        i += 1
        continue
    
    # Fix 2: Fix remaining finalProvider/finalModel references
    if 'recordRateLimitErrorAsync(finalProvider' in line:
        line = line.replace('recordRateLimitErrorAsync(finalProvider, finalModel)', 'recordRateLimitErrorAsync(actualProvider, actualModel)')
    
    # Fix 3: Merged comment + if statement (line with 'model-ranker        if')
    if 'model-ranker        if' in line:
        new_lines.append('       // Using dynamic import to avoid circular dependency with model-ranker\n')
        new_lines.append('       if (actualProvider && actualModel && actualModel !== \'unknown\') {\n')
        i += 1
        continue
    
    new_lines.append(line)
    i += 1

# Verify no remaining finalProvider/finalModel
content = ''.join(new_lines)
remaining_p = content.count('finalProvider')
remaining_m = content.count('finalModel')
print(f'finalProvider remaining: {remaining_p}')
print(f'finalModel remaining: {remaining_m}')

with open('lib/chat/chat-request-logger.ts', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print('Fixed and written')
