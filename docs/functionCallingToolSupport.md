 Function Calling & Text-Based Fallback Architecture

    This document describes how the system handles tool execution across models with varying function calling capabilities, ensuring graceful
    degradation when native tool calling is unavailable or ignored.

    1. Capability Detection Logic

    The primary gate is vercelModel.supports?.functionCalling in lib/chat/vercel-ai-streaming.ts.


    ┌──────────────────────────┬───────────┬─────────────────────────────────────────┬───────────────────────────────────────────┐
    │ supports.functionCalling │ Behavior  │ Tool Injection                          │ Fallback Mechanism                        │
    ├──────────────────────────┼───────────┼─────────────────────────────────────────┼───────────────────────────────────────────┤
    │ `true`                     │ Native FC │ Tools passed to streamText/generateText │ Vercel AI SDK handles execution natively. │
    └──────────────────────────┴───────────┴─────────────────────────────────────────┴───────────────────────────────────────────┘

    | `false` | Text Mode | Tools removed | TEXT_MODE_TOOL_INSTRUCTIONS injected into system prompt. Model outputs fenced text blocks (`
    ``file: path). |
    | `undefined` | Optimistic | Tools passed optimistically | If model returns raw text, downstream parsers scan for tool-like patterns. |

    > Note: Currently, only codellama has functionCalling: false in llm-providers-data.ts. Most cloud models return undefined, triggering the
    optimistic path.

    ---

    2. Execution Paths

    Path A: Native Function Calling (Standard)
     1. Tools: Passed to Vercel AI SDK tools parameter.
     2. LLM: Returns structured toolCalls/tool_results.
     3. Execution: onStepFinish callbacks or toolResults execute tools via ToolExecutor.
     4. Result: Files updated, VFS synced, memory graph updated.

    Path B: Text Mode (Explicit No-FC Models)
     1. Trigger: supports.functionCalling === false.
     2. System Prompt: Injects TEXT_MODE_TOOL_INSTRUCTIONS.
     3. LLM Output: Fenced blocks:
     1
    `file: path/to/file.js
       console.log("Hello");
     1
    `diff: path/to/style.css
        - color: red;
        + color: blue;
     1 4. **Parsing:** `extractFencedFileEdits()` extracts changes during streaming.
     2
    Path C: Optimistic + Fallback (Unknown Capability)
     1. Trigger: supports.functionCalling === undefined.
     2. LLM Output: May return raw text, JSON, or bash-style commands.
     3. Fallback Chain:
        - Mastra Agent: parseTextToolCalls() → extractFileEdits().
        - Stateful Agent: Scans result.text after generateText if toolCalls is empty.
        - Grammar Parser: GrammarToolCallParser scans for bash/function-call patterns.

    ---

    3. Supported LLM Output Formats

    The system parses 20+ formats to ensure maximum compatibility with models that don't support or ignore native tool calling.


    ┌───────────────────┬───────────────────────────────────────────────────────────┬─────────────────────────────┐
    │ Category          │ Format Example                                            │ Parser                      │
    ├───────────────────┼───────────────────────────────────────────────────────────┼─────────────────────────────┤
    │ JS Function Calls │ write_file({ "path": "...", "content": "..." })           │ extractTextToolCallEdits    │
    │ Flat JSON         │ { "tool": "write_file", "path": "...", "content": "..." } │ extractFlatJsonToolCalls    │
    │ Tool Tags         │ [Tool: write_file] { "path": "...", "content": "..." }    │ extractToolTagEdits         │
    │ Nested JSON       │ { "tool": "write_file", "arguments": { "path": "..." } }  │ extractJsonToolCalls        │
    │ XML Compact       │ <file_edit path="...">content</file_edit>                   │ extractCompactFileEdits     │
    │ XML Multiline     │ <file_edit><path>...</path>...</file_edit>                  │ extractMultiLineFileEdits   │
    │ HTML Comment      │ <!-- path -->content                                      │ extractHtmlCommentFileEdits │
    └───────────────────┴───────────────────────────────────────────────────────────┴─────────────────────────────┘

    | Fenced File | `
    file: path\ncontent\n  | extractFencedFileEdits` |
    | Fenced Diff | `
    diff: path\nunified-diff\n  | extractFencedDiffEdits` |
    | Bash Heredoc | cat > file << 'EOF'\ncontent\nEOF | extractBashFileEdits |
    | Bash Mkdir | mkdir -p path | extractMkdirEdits |
    | Bash Delete | rm -rf path | extractRmEdits |
    | Fenced Mkdir | `
    mkdir: path\n  | extractFencedMkdirEdits` |
    | Fenced Delete | `
    delete: path\n  | extractFencedDeleteBlocks` |
    | WRITE Heredoc | WRITE path <<<content>>> | extractFsActionWrites |
    | Top-level DELETE | DELETE path | extractDeleteEdits |
    | Top-level PATCH | PATCH path <<<diff>>> | extractPatchEdits |
    | JSON ws_action | { "ws_action": "CREATE", ... } | extractWsActionEdits |
    | JSON file_edit | { "file_edit": "path", ... } | extractSimpleJsonFileEdits |
    | Filename Hint | `
    typescript\n// path/to/file\ncontent\n  | extractFilenameHintCodeBlocks` |

    ---

    4. Key File Map


    ┌───────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────────┐
    │ File                                                  │ Role                                                                                │
    ├───────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────────┤
    │ lib/chat/vercel-ai-streaming.ts                       │ Gating Logic: Checks supports.functionCalling, injects text-mode instructions.      │
    │ lib/chat/file-edit-parser.ts                          │ Master Parser: extractFileEdits() dispatches all 20+ format extractors.             │
    │ lib/orchestra/mastra/agent-loop.ts                    │ Mastra Fallback: Calls parseTextToolCalls() when native calls fail.                 │
    │ lib/orchestra/stateful-agent/agents/stateful-agent.ts │ Stateful Fallback: Scans text in runEditingPhase() and runStatefulAgentStreaming(). │
    │ lib/tools/tool-integration/parsers/grammar-parser.ts  │ Grammar Parser: Handles bash/heredoc/function-call formats for EnhancedLLM.         │
    │ lib/chat/vercel-ai-tools.ts                           │ Tool Construction: Converts capabilities/MCP tools to Vercel AI SDK format.         │
    └───────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────────┘

    ---

    5. Configuration


    ┌────────────────────────────────┬─────────┬─────────────────────────────────────────────────────────────────────┐
    │ Environment Variable           │ Default │ Description                                                         │
    ├────────────────────────────────┼─────────┼─────────────────────────────────────────────────────────────────────┤
    │ TOOL_CALLING_MODE                │ "auto"  │ Parser mode: native, grammar, xml, or auto.                         │
    │ TOOL_CALLING_ALLOW_CONTENT_PARSING │ "false" │ If true, allows grammar/XML parsing when native calls return empty. │
    └────────────────────────────────┴─────────┴─────────────────────────────────────────────────────────────────────┘

    ---

    6. Recent Improvements

     1. Extraction to Shared Parsers: extractTextToolCallEdits, extractFlatJsonToolCalls, and extractToolTagEdits extracted to file-edit-parser.ts for
        reuse across Mastra and Stateful agents.
     2. Grammar Parser Enhancement: Added function-call, flat JSON, and tool tag parsing to GrammarToolCallParser for the EnhancedLLM dispatcher.
     3. Stateful Agent Fallback: Added text-based fallback to both runEditingPhase() and runStatefulAgentStreaming() to catch models that ignore tools
        in the Stateful Agent workflow.
     4. Deduplication Fix: parseTextToolCalls now delegates directly to extractFileEdits(), ensuring all formats are handled without duplicating
        scanning logic.

    ---

    7. Adding New Formats

    To support a new LLM output format:

     1. Add the extractor function to lib/chat/file-edit-parser.ts.
     2. Call the new extractor in extractFileEdits().
     3. Add tests to __tests__/chat/file-edit-parser.test.ts.
     4. If the format uses JS syntax, consider adding it to GrammarToolCallParser as well.