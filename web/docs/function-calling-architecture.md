# Function Calling & Text-Based Fallback Architecture

This document describes how the system handles tool execution across models with varying function calling capabilities, ensuring graceful degradation when native tool calling is unavailable or ignored.

## 1. Capability Detection Logic

The primary gate is `vercelModel.supports?.functionCalling` in `lib/chat/vercel-ai-streaming.ts`.

| `supports.functionCalling` | Behavior | Tool Injection | Fallback Mechanism |
|----------------------------|----------|----------------|--------------------|
| **`true`** | Native FC | Tools passed to `streamText`/`generateText` | Vercel AI SDK handles execution natively. |
| **`false`** | Text Mode | **Tools removed** | `TEXT_MODE_TOOL_INSTRUCTIONS` injected into system prompt. Model outputs fenced text blocks (` ```file: path`). |
| **`undefined`** | Optimistic | Tools passed optimistically | If model returns raw text, downstream parsers scan for tool-like patterns. |

> **Note:** Currently, only `codellama` has `functionCalling: false` in `llm-providers-data.ts`. Most cloud models return `undefined`, triggering the optimistic path.

---

## 2. Execution Paths

### Path A: Native Function Calling (Standard)
1. **Tools:** Passed to Vercel AI SDK `tools` parameter.
2. **LLM:** Returns structured `toolCalls`/`tool_results`.
3. **Execution:** `onStepFinish` callbacks or `toolResults` execute tools via `ToolExecutor`.
4. **Result:** Files updated, VFS synced, memory graph updated.

### Path B: Text Mode (Explicit No-FC Models)
1. **Trigger:** `supports.functionCalling === false`.
2. **System Prompt:** Injects `TEXT_MODE_TOOL_INSTRUCTIONS`.
3. **LLM Output:** Fenced blocks:
   ```markdown
   ```file: path/to/file.js
   console.log("Hello");
   ```
   ```diff: path/to/style.css
   - color: red;
   + color: blue;
   ```
   ```
4. **Parsing:** `extractFileEdits()` extracts changes during streaming.

### Path C: Optimistic + Fallback (Unknown Capability)
1. **Trigger:** `supports.functionCalling === undefined`.
2. **LLM Output:** May return raw text, JSON, or bash-style commands.
3. **Fallback Chain:**
   - **Mastra Agent:** `parseTextToolCalls()` → `extractFileEdits()`.
   - **Stateful Agent:** Scans `result.text` after `generateText` if `toolCalls` is empty.
   - **EnhancedLLM Dispatcher:** Uses `extractFileEdits()` as single source of truth for content-based parsing.

---

## 3. Supported LLM Output Formats

The system parses **20+ formats** to ensure maximum compatibility with models that don't support or ignore native tool calling.

| Category | Format Example | Parser |
|----------|----------------|--------|
| **JS Function Calls** | `write_file({ "path": "...", "content": "..." })` | `extractTextToolCallEdits` |
| **Flat JSON** | `{ "tool": "write_file", "path": "...", "content": "..." }` | `extractFlatJsonToolCalls` |
| **Tool Tags** | `[Tool: write_file] { "path": "...", "content": "..." }` | `extractToolTagEdits` |
| **Nested JSON** | `{ "tool": "write_file", "arguments": { "path": "..." } }` | `extractJsonToolCalls` |
| **XML Compact** | `<file_edit path="...">content</file_edit>` | `extractCompactFileEdits` |
| **XML Multiline** | `<file_edit><path>...</path>...</file_edit>` | `extractMultiLineFileEdits` |
| **HTML Comment** | `<!-- path -->content` | `extractHtmlCommentFileEdits` |
| **Fenced File** | ` ```file: path\ncontent\n``` ` | `extractFencedFileEdits` |
| **Fenced Diff** | ` ```diff: path\nunified-diff\n``` ` | `extractFencedDiffEdits` |
| **Bash Heredoc** | `cat > file << 'EOF'\ncontent\nEOF` | `extractBashFileEdits` |
| **Bash Mkdir** | `mkdir -p path` | `extractMkdirEdits` |
| **Bash Delete** | `rm -rf path` | `extractRmEdits` |
| **Fenced Mkdir** | ` ```mkdir: path\n``` ` | `extractFencedMkdirEdits` |
| **Fenced Delete** | ` ```delete: path\n``` ` | `extractFencedDeleteBlocks` |
| **WRITE Heredoc** | `WRITE path <<<content>>>` | `extractFsActionWrites` |
| **Top-level DELETE** | `DELETE path` | `extractDeleteEdits` |
| **Top-level PATCH** | `PATCH path <<<diff>>>` | `extractPatchEdits` |
| **JSON ws_action** | `{ "ws_action": "CREATE", ... }` | `extractWsActionEdits` |
| **JSON file_edit** | `{ "file_edit": "path", ... }` | `extractSimpleJsonFileEdits` |
| **Filename Hint** | ` ```typescript\n// path/to/file\ncontent\n``` ` | `extractFilenameHintCodeBlocks` |

---

## 4. Key File Map

| File | Role |
|------|------|
| `lib/chat/vercel-ai-streaming.ts` | **Gating Logic:** Checks `supports.functionCalling`, injects text-mode instructions. |
| `lib/chat/file-edit-parser.ts` | **Master Parser:** `extractFileEdits()` dispatches all 20+ format extractors. Single source of truth. |
| `lib/orchestra/mastra/agent-loop.ts` | **Mastra Fallback:** Calls `parseTextToolCalls()` → `extractFileEdits()` when native calls fail. |
| `lib/orchestra/stateful-agent/agents/stateful-agent.ts` | **Stateful Fallback:** Scans text in `runEditingPhase()` and `runStatefulAgentStreaming()`. |
| `lib/tools/tool-integration/parsers/dispatcher.ts` | **EnhancedLLM Dispatcher:** Uses `extractFileEdits()` for content-based parsing. No separate grammar parser. |
| `lib/chat/vercel-ai-tools.ts` | **Tool Construction:** Converts capabilities/MCP tools to Vercel AI SDK format. |

---

## 5. Configuration

| Environment Variable | Default | Description |
|----------------------|---------|-------------|
| `TOOL_CALLING_MODE` | `"auto"` | Dispatcher mode: `native`, `content`, `xml`, or `auto`. |
| `TOOL_CALLING_ALLOW_CONTENT_PARSING` | `"false"` | If `true`, allows content-based parsing when native calls return empty. |

---

## 6. Architecture Consolidation

### Removed: `grammar-parser.ts`

Previously, the dispatcher had a separate `GrammarToolCallParser` that duplicated parsing logic already in `extractFileEdits()`. This has been consolidated:

- **Before:** Dispatcher had Native → Grammar → XML chain with ~200 lines of duplicated parsing logic.
- **After:** Dispatcher calls `extractFileEdits()` directly, converting `FileEdit[]` to `ParsedToolCall[]`. Single source of truth for all text-based formats.

### Benefits:
1. **No duplication:** All 20+ formats maintained in one place (`file-edit-parser.ts`).
2. **Consistent behavior:** Same extraction logic across Mastra, Stateful, and EnhancedLLM paths.
3. **Easier maintenance:** Adding a new format only requires updating `file-edit-parser.ts`.

---

## 7. Adding New Formats

To support a new LLM output format:

1. Add the extractor function to `lib/chat/file-edit-parser.ts`.
2. Call the new extractor in `extractFileEdits()`.
3. Add tests to `__tests__/chat/file-edit-parser.test.ts`.
4. If the format produces new tool names, update `editsToToolCalls()` in `dispatcher.ts` to map the action.

---

## 8. Complete Fallback Chain

```
┌─────────────────────────────────────────────────────┐
│ Model reports supports.functionCalling = false      │
├─────────────────────────────────────────────────────┤
│ 1. Tools deleted from streamText/generateText        │
│ 2. TEXT_MODE_TOOL_INSTRUCTIONS injected              │
│ 3. Model outputs: ```file: path\n...\```            │
│ 4. extractFileEdits() parses fenced formats ✅       │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Model reports supports.functionCalling = undefined  │
│ (or true, but model ignores tools)                   │
├─────────────────────────────────────────────────────┤
│ 1. Tools passed to streamText/generateText           │
│ 2. Model returns raw text (no native tool calls)     │
│ 3. parseTextToolCalls() / fallback parsers scan text │
│ 4. All 20+ formats extracted ✅                      │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Model reports supports.functionCalling = true        │
│ AND model supports native function calling           │
├─────────────────────────────────────────────────────┤
│ 1. Tools passed to streamText/generateText           │
│ 2. Model returns structured tool_calls ✅            │
│ 3. No text parsing needed                            │
└─────────────────────────────────────────────────────┘
```
