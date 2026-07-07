#!/usr/bin/env python3
"""Consolidate classifyResponseShape in unified-agent-service.ts to use the
canonical helper from '@/lib/tools/unified-response-handler' (which has 16
unit tests covering whitespace, null, non-string, non-array edge cases).

Strategy: 5 atomic replacements:
  (A) Insert the new import after the existing '@/lib/tools' import
  (B) Delete the now-obsolete ResponseShape type alias + classifyResponseShape
      function block (inserted in the earlier turn)
  (C) Replace site 1 (responseShape computation) — use structured helper call
  (D) Replace site 2 (telemetryResponseShape computation) — use structured
      helper call
  (E) Trim the 5-line stale comment block above site 2
"""

import sys

PATH = '/opt/bing/web/lib/orchestra/unified-agent-service.ts'

with open(PATH, 'r', encoding='utf-8') as f:
    content = f.read()

# === A) Insert import after the existing '@/lib/tools' import ===============
# Note: place AFTER the existing @/lib/tools line, NOT inside the tools block
# (which has additional imports below), keeping the alphabetical/logical grouping.
A_OLD = "import { initToolSystem, executeToolCapability, hasToolCapability, isToolSystemReady } from '@/lib/tools';"
A_NEW = (
    "import { initToolSystem, executeToolCapability, hasToolCapability, isToolSystemReady } from '@/lib/tools';\n"
    "// Bug #91 (Pass-6) shared response-shape classifier. Importing the canonical\n"
    "// version from unified-response-handler (with 16 unit tests covering\n"
    "// whitespace/null/non-string/non-array edge cases) instead of duplicating\n"
    "// the logic here. See lib/tools/__tests__/classify-response-shape.test.ts.\n"
    "import { classifyResponseShape, type ResponseShape } from '@/lib/tools/unified-response-handler';"
)
if content.count(A_OLD) != 1:
    print(f'[A FAIL] anchor match count = {content.count(A_OLD)}, expected 1')
    sys.exit(1)
content = content.replace(A_OLD, A_NEW, 1)
print('[A OK] inserted import for canonical classifyResponseShape')

# === B) Delete my private helper block =====================================
# The block was inserted earlier in this conversation at module scope, just
# before classifyProviderError. Its defining anchor is the helper header
# comment. We delete it in one shot.
B_OLD_START = (
    "/**\n"
    " * Classify an LLM response + tool-execution pair into one of four shapes.\n"
    " * Shared helper for the [V1-API-WITH-TOOLS] log line (line ~4269) and the\n"
    " * [Telemetry-v1Api] log line (line ~4360) in this same `runV1ApiWithTools`\n"
    " * function, so the two sites cannot drift on the taxonomy. Bug #117:\n"
    " * \"tools_only\" must remain distinguishable from \"empty\" — a single LLM\n"
    " * call that produced zero text but >=1 tool call is a real category\n"
    " * (pure-tool reply) and must not silently merge into \"empty\".\n"
    " *\n"
    " *   - \"empty\"      no text, no tool calls (possible stall pattern)\n"
    " *   - \"tools_only\" no text, >=1 tool call (rare; pure-tool reply)\n"
    " *   - \"text\"       text, no tool calls\n"
    " *   - \"mixed\"      text AND >=1 tool call\n"
    " *\n"
    " * @param responseLength  `result.response.length` after stringification\n"
    " * @param toolCount       number of recorded tool invocations\n"
    " */\n"
    "type ResponseShape = 'text' | 'tools_only' | 'mixed' | 'empty';\n"
    "function classifyResponseShape(\n"
    "  responseLength: number,\n"
    "  toolCount: number,\n"
    "): ResponseShape {\n"
    "  const hasResponse = responseLength > 0;\n"
    "  const hasTools = toolCount > 0;\n"
    "  if (hasResponse && hasTools) return 'mixed';\n"
    "  if (hasResponse) return 'text';\n"
    "  if (hasTools) return 'tools_only';\n"
    "  return 'empty';\n"
    "}\n"
    "\n"
)
if B_OLD_START not in content:
    print('[B FAIL] private helper block not found verbatim.')
    # Probe to find current state
    idx = content.find('function classifyResponseShape(')
    if idx >= 0:
        print('Current classifyResponseShape location (200 before, 600 after):')
        print(repr(content[max(0, idx-200):idx+600]))
    sys.exit(1)
content = content.replace(B_OLD_START, '', 1)
print('[B OK] deleted private helper block (now uses canonical import)')

# === C) Site 1: collapse numeric helper call -> structured helper call ===
C_OLD = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable. Helper shared with the [Telemetry-v1Api] site\n"
    "      // below (same function scope — keep taxonomies in lockstep).\n"
    "      const responseShape = classifyResponseShape(response.length, toolInvocations.length);\n"
)
C_NEW = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable (Bug #91 canonical helper, 16 unit tests).\n"
    "      const responseShape = classifyResponseShape({\n"
    "        response,\n"
    "        toolCalls: toolInvocations.map((i) => ({ name: i.toolName, args: i.args })),\n"
    "      });\n"
)
if C_OLD not in content:
    print('[C FAIL] site 1 not found.')
    idx = content.find('const responseShape = classifyResponseShape')
    if idx >= 0:
        print('current state of site 1 (500 around):')
        print(repr(content[max(0, idx-300):idx+300]))
    sys.exit(1)
content = content.replace(C_OLD, C_NEW, 1)
print('[C OK] site 1 now uses canonical helper with structured input')

# === D + E) Site 2: collapse numeric helper call -> structured + trim ======
DE_OLD = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable. Helper shared with the [V1-API-WITH-TOOLS]\n"
    "      // site above — same function scope, same taxonomy. Local keeps the\n"
    "      // `telemetry` prefix to avoid shadowing the outer `responseShape`\n"
    "      // (otherwise this would re-trigger the original duplicate-identifier\n"
    "      // error). Tool-count source differs from site 1 (`toolCallTelemetry`\n"
    "      // vs `toolInvocations`); `.length` is equivalent for the booleans.\n"
    "      const telemetryResponseShape = classifyResponseShape(response.length, toolCallTelemetry.length);\n"
)
DE_NEW = (
    "      // Bug #117 fix: classify response shape so \"tools_only\" vs \"empty\"\n"
    "      // is distinguishable (Bug #91 canonical helper, 16 unit tests).\n"
    "      // Local keeps the `telemetry` prefix because site 1 above declares\n"
    "      // `responseShape` in this same function scope.\n"
    "      const telemetryResponseShape = classifyResponseShape({\n"
    "        response,\n"
    "        toolCalls: toolCallTelemetry.map((t) => ({ name: t.toolName, args: t.args })),\n"
    "      });\n"
)
if DE_OLD not in content:
    print('[D/E FAIL] site 2 not found.')
    idx = content.find('const telemetryResponseShape = classifyResponseShape')
    if idx >= 0:
        print('current state of site 2 (500 around):')
        print(repr(content[max(0, idx-300):idx+300]))
    sys.exit(1)
content = content.replace(DE_OLD, DE_NEW, 1)
print('[D/E OK] site 2 now uses canonical helper with structured input + trimmed comment')

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(content)

print('\n=== DONE ===')
