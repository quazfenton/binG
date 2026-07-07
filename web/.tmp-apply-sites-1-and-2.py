#!/usr/bin/env python3
"""Apply site 1 + site 2 final edits — convert numeric helper calls to
structured {response, toolCalls} input for the canonical imported helper,
and trim the stale comments.

In the prior script (A/B) the import was inserted and my private helper was
deleted. (C/D/E) failed because the fixed oldString assumed a 3-line comment
that was in the script but not in the actual current file (the prior edit
only collapsed the ternary, leaving the original 1-line comment in place).

This script handles the actual current file state.
"""

import sys

PATH = '/opt/bing/web/lib/orchestra/unified-agent-service.ts'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# === Site 1: collapse to structured helper call, replace 1-line comment with 2-line ===
SITE1_OLD = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\" is distinguishable\n"
    "      const responseShape = classifyResponseShape(response.length, toolInvocations.length);\n"
)
SITE1_NEW = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable (Bug #91 canonical helper, 16 unit tests).\n"
    "      const responseShape = classifyResponseShape({\n"
    "        response,\n"
    "        toolCalls: toolInvocations.map((i) => ({ name: i.toolName, args: i.args })),\n"
    "      });\n"
)
if SITE1_OLD not in content:
    print('[site1 FAIL] verbatim match not found.')
    idx = content.find('const responseShape = classifyResponseShape')
    if idx >= 0:
        print('current site 1 (300 around):')
        print(repr(content[max(0, idx-300):idx+300]))
    sys.exit(1)
content = content.replace(SITE1_OLD, SITE1_NEW, 1)
print('[site1 OK] structured helper call + comment replaced')

# === Site 2: collapse numeric helper call to structured, trim stale 7-line comment ===
SITE2_OLD = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" is distinguishable from \"empty\"\n"
    "      // Renamed from `responseShape` to avoid the duplicate-identifier\n"
    "      // collision with the earlier `responseShape` at line ~4269 in\n"
    "      // `runV1ApiWithTools`. The earlier one classifies the response for\n"
    "      // the `[V1-API-WITH-TOOLS]` log line; this one feeds the telemetry\n"
    "      // payload (same shape taxonomy, different source of truth for the\n"
    "      // tool-count side: `toolInvocations` vs `toolCallTelemetry`).\n"
    "      const telemetryResponseShape = classifyResponseShape(response.length, toolCallTelemetry.length);\n"
)
SITE2_NEW = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable (Bug #91 canonical helper, 16 unit tests).\n"
    "      // Local keeps the `telemetry` prefix because site 1 above declares\n"
    "      // `responseShape` in this same function scope.\n"
    "      const telemetryResponseShape = classifyResponseShape({\n"
    "        response,\n"
    "        toolCalls: toolCallTelemetry.map((t) => ({ name: t.toolName, args: t.args })),\n"
    "      });\n"
)
if SITE2_OLD not in content:
    print('[site2 FAIL] verbatim match not found.')
    idx = content.find('const telemetryResponseShape = classifyResponseShape')
    if idx >= 0:
        print('current site 2 (300 around):')
        print(repr(content[max(0, idx-400):idx+400]))
    sys.exit(1)
content = content.replace(SITE2_OLD, SITE2_NEW, 1)
print('[site2 OK] structured helper call + stale comment trimmed')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n=== DONE ===')
