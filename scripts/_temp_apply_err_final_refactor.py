#!/usr/bin/env python3
"""
One-shot refactor: lift the SSE-stall discriminator block from
use-enhanced-chat.ts case 'error' into the pure buildErrorFinalContent
helper. The pure helper is the gap-closer for the audit's "weak primary
defense" critique (the shape-lock vitest alone cannot catch behavioral
regressions in the 6-case discriminator state machine).
"""
import sys
from pathlib import Path

ROOT = Path('/opt/bing/web/hooks/use-enhanced-chat.ts')

src = ROOT.read_text(encoding='utf-8')

# ─── EDIT 1: add the import after the chat-metrics import ───────────
anchored_import_old = "import { recordFallbackChainAttempt, recordFallbackChainExhausted } from '@/lib/chat/chat-metrics';"
anchored_import_new = (
    "import { recordFallbackChainAttempt, recordFallbackChainExhausted } from '@/lib/chat/chat-metrics';\n"
    "// F1 finding: SSE-stall discriminator lifted to a pure helper so it\n"
    "// can be unit-tested without React hook setup. The hook keeps the\n"
    "// F8 anchor (`const err = eventData;`) so `err.stack` substring\n"
    "// remains pinned by the audit-regression test.\n"
    "import { buildErrorFinalContent } from '@/lib/chat/build-error-final-content';"
)
assert src.count(anchored_import_old) == 1, f"expected import anchor count=1, got {src.count(anchored_import_old)}"
src = src.replace(anchored_import_old, anchored_import_new, 1)

# ─── EDIT 2: replace the inline 18-line discriminator block with the
#     single-line helper call. Preserves the F8 anchor
#     (`const err = eventData; // F8: alias ...`) emitted below the call.
# ──────────────────────────────────────────────────────────────────────
anchored_block_old = (
    "                  // SSE-stall discriminator — route.ts emitSseError call from\n"
    "                  // fireStall sets isStall:true when the Rec #2 watchdog fires\n"
    "                  // mid-stream. Without this branch, \"Stream interrupted...\"\n"
    "                  // gets rendered for stall cases — misleading operators into\n"
    "                  // retrying a request the server already timed out.\n"
    "                  const isStall = eventData.isStall === true;\n"
    "                  const errMsg = eventData.message || eventData.error || 'Streaming error';\n"
    "                  const canRetry = isStall ? false : (eventData.canRetry !== false);\n"
    "                  const hadContent = !!accumulatedContent.trim();\n"
    "                  const err = eventData; // F8: alias so the literal `err.stack` substring is present (pinned by audit-regression test).\n"
    "                  let finalContent: string;\n"
    "                  if (isStall) {\n"
    "                    finalContent = hadContent\n"
    "                      ? accumulatedContent + '\\n\\n⚠️ _Server timed out — please try again._'\n"
    "                      : '⚠️ _Server timed out — please try again._';\n"
    "                  } else {\n"
    "                    const errorSuffix = canRetry\n"
    "                      ? `\\n\\n⚠️ _Stream interrupted: ${errMsg}. You can retry._`\n"
    "                      : `\\n\\n⚠️ _${errMsg}_`;\n"
    "                    finalContent = hadContent\n"
    "                      ? accumulatedContent + errorSuffix\n"
    "                      : `⚠️ ${errMsg}${canRetry ? ' Please retry your request.' : ''}`;\n"
    "                  }"
)
anchored_block_new = (
    "                  // SSE-stall discriminator — route.ts emitSseError call from\n"
    "                  // fireStall sets isStall:true when the Rec #2 watchdog fires\n"
    "                  // mid-stream. Without this branch, \"Stream interrupted...\"\n"
    "                  // gets rendered for stall cases — misleading operators into\n"
    "                  // retrying a request the server already timed out.\n"
    "                  // Discriminator lifted to lib/chat/build-error-final-content.ts\n"
    "                  // (pure helper, unit-tested without React hook setup). The\n"
    "                  // shape-lock vitest at __tests__/audit-recs/finding-1-\n"
    "                  // stall-discriminator.test.ts reads both files; the\n"
    "                  // behavioral vitest at __tests__/chat/build-error-final-\n"
    "                  // content.test.ts pins each of the 6 partitions.\n"
    "                  const { finalContent, isStall, canRetry, errMsg } = buildErrorFinalContent({ accumulatedContent, eventData });\n"
    "                  const err = eventData; // F8: alias so the literal `err.stack` substring is present (pinned by audit-regression test)."
)
anchored_block_count = src.count(anchored_block_old)
assert anchored_block_count == 1, f"expected block anchor count=1, got {anchored_block_count}"
src = src.replace(anchored_block_old, anchored_block_new, 1)

# Write back
ROOT.write_text(src, encoding='utf-8')

print("use-enhanced-chat.ts refactor complete")
print(f"  - import added after chat-metrics line")
print(f"  - 18-line discriminator block → single-line helper call")
