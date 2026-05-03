#!/usr/bin/env python3
import re

filepath = 'packages/shared/agent/modula.ts'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace task: request.task with userMessage: request.task in processUnifiedAgentRequest calls
# Need to be careful to only replace inside these calls

# Pattern: inside processUnifiedAgentRequest({ ... }), replace task: with userMessage:
# We'll do a simple string replace since the pattern is consistent
content = content.replace('task: request.task,', 'userMessage: request.task,')
content = content.replace('task: `[SPEC_AMPLIFY]', 'userMessage: `[SPEC_AMPLIFY]')
content = content.replace('task: `[SPEC_MAXIMAL]', 'userMessage: `[SPEC_MAXIMAL]')
content = content.replace('task: specResult.response,', 'userMessage: specResult.response,')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed task -> userMessage in processUnifiedAgentRequest calls")
