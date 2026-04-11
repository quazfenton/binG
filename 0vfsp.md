Review the VFS MCP tool architecture and              █
    │   file-edit-parser fallback system for LLM tool         █
    │   calling reliability improvements. The system has      █
    │   high error rates with many models failing to          █
    │   successfully call structured tools. Analyze:          █
    │                                                         █
    │   1. Tool Schema Design: Are the Zod schemas and        █
    │      descriptions optimal for LLM understanding?        █
    │   2. Self-Healing Opportunities: What retry/recovery    █
    │      mechanisms could be added?                         █
    │   3. System Prompt Engineering: Are the                 █
    │      TEXT_MODE_TOOL_INSTRUCTIONS optimal?               █
    │   4. Parser Robustness: What patterns are the           █
    │      file-edit-parser missing?                          █
    │   5. stdio/Transport Issues: Could there be             █
    │      streaming/chunking issues?                         █
    │   6. Tool Call Format Normalization: Can we better      █
    │      normalize malformed tool calls before execution?   █


Recommended changes                                   █
                                                              █
        1.1 Use Zod preprocess to normalize args before       █
        validation                                            █
                                                              █
        You already do heavy normalization manually for       █
        batch_write in execute. Move that logic into a        █
        shared preprocessor so Zod sees normalized objects:   █
                                                              █
            // shared/normalize-tool-args.ts                  █
            export function                                   █
            normalizeToolArgs(toolName: string, raw:
       █
            'file_path']);                                    █
                        const content = alias.call(pf,        ▁
            ['content', 'contents', 'code', 'text',           ▁
            'body']);                                         █
                        return { ...pf, path, content         █
            };                                                █
                      });                                     █
                  }                                           █
                  return { ...obj, files };                   █
                }                                             █
                // ...similar for delete_file,                █
            create_directory if needed                        █
                default:                                      █
                  return obj;                                 █
              }                                               █
            }                                                 █
                                                              █
        Then in your tool definitions:                        █
                                                              █
            import { normalizeToolArgs } from                 █
            './shared/normalize-tool-args';                   █
                                                              █
            export const writeFileTool = (tool as             █
            any)({                                            █
              description: 'Create or overwrite a file        █
            in the VFS.',                                     █
              parameters: z.preprocess(                       █
                (raw) =>                                      █
            normalizeToolArgs('write_file', raw),             █
                z.object({                                    █
                  path: z.string().describe('File path        █
            to write (relative to workspace/session)'),       █
                  content: z.string().describe('Full          █
            file content'),                                   █
                }),                                           █
              ),                                              █
              execute: async ({ path, content }) => {         █
            /* unchanged */ },                                █
            });                                               █
                                                              █
        And for batch_write:                                  █
                                                              █
            parameters: z.preprocess(                         █
              (raw) =>                                        █
            normalizeToolArgs('batch_write', raw),            █
              z.object({                                      █
                files: z.array(                               █
                  z.object({                                  █
                    path: z.string(),

█
                    content: z.string(),                      █
                  })                                          █
                ).max(50),                                    ▂
              })                                              ▂
            ),                                                █
                                                              █
        Impact:                                               █
        • Models can use many common aliases (filename,       █
          code, etc.) and still succeed.                      █
        • Stringified JSON, top-level arrays, and { files:    █
          [...] } all work consistently.                      █
        • You keep Zod safety but gain fault tolerance.       █
                                                              █
        Effort: M (1–3h) for core tools.                      █
                                                              █
        ---                                                   █
                                                              █
        1.2 Make schemas more LLM-friendly and permissive     █
                                                              █
        • Use .passthrough() or .strict(false) where extra    █
          properties are harmless:                            █
                                                              █
            z.object({                                        █
              path: z.string(),                               █
              content: z.string(),                            █
            }).passthrough();                                 █
                                                              █
        • Ensure descriptions are short and explicit;         █
          avoid vague wording. E.g.:                          █
                                                              █
            path: z.string().describe('Relative path          █
            like "src/app.tsx" (no URL, no query              █
            string).'),                                       █
            content: z.string().describe('Complete            █
            file contents; do not abbreviate or               █
            truncate.'),                                      █
                                                              █
        • For batch_write, spell out “array of { path,        █
          content }” explicitly in the field description      █
          and add a one-line JSON example in the tool         █
          description.                                        █
                                                              █
        ---                                                   █
                                                              █
        2) Self-Healing Opportunities (retry/recovery)        █
                                                              █
        2.1 Normalize and re-validate on tool-call errors     █
                                                              █
        Where you handle tool calls in                        █
        vercel-ai-streaming.ts (in the tool-call case),       █




           █
        add a normalization + self-healing attempt before     █
        failing:                                              █
                                                              █
            case 'tool-call': {                               ▃
              onFirstToken();                                 ▃
              const toolName = (chunk as any).toolName;       █
              const toolCallId = (chunk as                    █
            any).toolCallId;                                  █
              let callArgs = (chunk as any).args ||           █
            (chunk as any).arguments || {};                   █
                                                              █
              // 1) Normalize args                            █
              const normalized =                              █
            normalizeToolArgs(toolName, callArgs);            █
                                                              █
              // 2) Log diff for debugging                    █
              chatLogger.debug('[TOOL-CALL] Normalized        █
            args', {                                          █
                toolCallId,                                   █
                toolName,                                     █
                originalKeys: Object.keys(callArgs ||         █
            {}),                                              █
                normalizedKeys: Object.keys(normalized        █
            || {}),                                           █
              });                                             █
                                                              █
              // 3) Replace args before passing to AI         █
            SDK / executor                                    █
              (chunk as any).args = normalized;               █
                                                              █
              // continue existing processing...              █
            }                                                 █
                                                              █
        If Zod still throws inside the tool, catch that at    █
        the tool-execution layer and:                         █
                                                              █
        • log a structured error: missing fields, wrong       █
          types etc.                                          █
        • optionally trigger a single retry completion        █
          where you prompt the LLM with:                      █
                                                              █
          │ The previous tool call for <toolName>             █
          │ failed with this error: <short error>.            █
          │ Re-emit the same tool call but only with          █
          │ valid JSON arguments matching this schema:        █
          │ …                                                 █
                                                              █
        You can do this using a low-temperature follow-up     █
        call reusing the conversation plus one system         █
        message and the exact error.



                                      █
                                                              █
        ---                                                   █
                                                              ▄
        2.2 Guard against incomplete / empty tool calls       ▄
                                                              █
        You’re already logging empty args:                    █
                                                              █
            if (!hasArgs) {                                   █
              chatLogger.error('[TOOL-CALL] ✗ EMPTY           █
            args detected - tool likely to fail', ...);       █
            }                                                 █
                                                              █
        Turn that into a recoverable path:                    █
                                                              █
        • Detect EMPTY args → do not execute the tool.        █
        • Instead, treat it as a malformed attempt and:       █
            • append an internal assistant message “Tool      █
              call failed due to empty arguments” and         █
            • send a follow-up LLM call with an explicit      █
              instruction to retry the tool call with full    █
              arguments.                                      █
                                                              █
        Even a simple heuristic like “1 retry per             █
        toolCallId if args are empty or obviously invalid”    █
        will recover a decent share of failures.              █
                                                              █
        ---                                                   █
                                                              █
        3) System Prompt Engineering                          █
        (TEXT_MODE_TOOL_INSTRUCTIONS)                         █
                                                              █
        3.1 Avoid mixing function-calling and text-mode in    █
        the same call when possible                           █
                                                              █
        Today:                                                █
                                                              █
        • When supportsFC === false: you correctly strip      █
          tools and inject TEXT_MODE_TOOL_INSTRUCTIONS.       █
        • When supportsFC === undefined: you keep tools       █
          and inject text-mode instructions as fallback.      █
                                                              █
        This second case is very likely causing               █
        confusion—models often choose the simpler text        █
        format instead of using tools, even if they           █
        technically support function calling.                 █
                                                              █
        Change: make it two-phase for unknown FC capability


                    █
        1. First attempt:                                     █
             • Use tools only; do not inject text-mode        █
               instructions.                                  █
             • Track whether any tool calls are produced.     █
        2. If:                                                ▅
             • no tool calls are produced, or                 ▅
             • tool calls repeatedly fail Zod validation /    █
               execution,                                     █
               then:                                          █
             • issue a second completion where you:           █
                   • remove tools from                        █
                     streamOptions.tools, and                 █
                   • inject TEXT_MODE_TOOL_INSTRUCTIONS.      █
                                                              █
        That avoids overloading the model with two            █
        competing patterns at once.                           █
                                                              █
        Effort: M (1–3h).                                     █
                                                              █
        ---                                                   █
                                                              █
        3.2 Sharpen the text-mode instructions                █
                                                              █
        Your current TEXT_MODE_TOOL_INSTRUCTIONS are good,    █
        but a few tweaks will help:                           █
                                                              █
        • Make it completely unambiguous that                 █
          file/diff/mkdir/delete blocks are the only place    █
          file ops should appear:                             █
                                                              █
          Add:                                                █
                                                              █
            │ • Do NOT describe file operations in            █
            │   plain text.                                   █
            │ • Do NOT mix explanations inside file:          █
            │   or diff: blocks. Use separate normal          █
            │   code fences for explanations.                 █
        • Add explicit examples of multiple files             █
          (separate blocks):                                  █
                                                              █
            ```file: src/a.ts                                 █
            // content                                        █
                                                              █
            // content                                        █
                                                              █
            - Emphasize “one file or directory per            █
            block”.                                           █
                                                              █
            This reduces weird hybrid formats that don’t match any parser pattern.                   █
                                                              █
            ---                                               █
                                                              █
            ## 4) Parser Robustness                           █
            (file-edit-parser.ts)                             █
                                                              ▅
            ### 4.1 Reuse tolerant JSON parsing for           ▅
            JSON-based formats                                █
                                                              █
            You already have a robust tolerant parser         █
            in `parseBatchWriteFiles` (`tryParseJson`         █
            with trailing comma, single quotes,               █
            control char handling).                           █
                                                              █
            **Repurpose that into a shared utility**          █
            and use it in:                                    █
                                                              █
            - `extractJsonToolCalls`                          █
            - `extractToolNameFencedBlocks`                   █
                                                              █
            Example:                                          █
                                                              █
            ```ts                                             █
            // json-tolerant.ts                               █
            export function tolerantJsonParse(text:           █
            string): unknown {                                █
              // essentially your tryParseJson +              █
            sanitizeJsonString                                █
            }                                                 █
                                                              █
        Then:                                                 █
                                                              █
            // extractJsonToolCalls                           █
            const obj = tolerantJsonParse(jsonStr);           █
            if (!obj || typeof obj !== 'object')              █
            continue;                                         █
                                                              █
            // extractToolNameFencedBlocks                    █
            const parsed =                                    █
            tolerantJsonParse(codeBlock);                     █
            if (!parsed || typeof parsed !== 'object')        █
            continue;                                         █
                                                              █
        This will dramatically improve success for:           █
                                                              █
        • single-quoted JSON                                  █
        • trailing commas                                     █
        • unescaped newlines inside strings                   █
        • JSON-with-“files=” prefixes etc.





     █
        • JSON-with-“files=” prefixes etc.                    █
                                                              █
        Effort: S (≤1h).                                      █
                                                              █
        ---                                                   █
                                                              █
        4.2 Support more JSON tool-call variants and          █
        aliases                                               ▆
                                                              ▆
        In extractJsonToolCalls:                              █
                                                              █
        • Right now you require "tool" and "arguments" and    █
          expect exact keys like path, content, files.        █
          Extend to:                                          █
                                                              █
            • function, name, or tool_name                    █
              (Anthropic/OpenAI variants).                    █
            • args or parameters in addition to arguments.    █
            • key aliases for path/content as in              █
              normalizeToolArgs.                              █
                                                              █
        Example adjustment:                                   █
                                                              █
            const toolFieldName = ['tool', 'function',        █
            'name', 'tool_name'].find(f => f in obj);         █
            const argsFieldName = ['arguments',               █
            'args', 'parameters'].find(f => f in obj);        █
            const toolName = (toolFieldName && (obj as        █
            any)[toolFieldName])?.toLowerCase();              █
            const args = argsFieldName ? (obj as              █
            any)[argsFieldName] : undefined;                  █
                                                              █
        Then run the same alias-based field mapping as in     █
        normalizeToolArgs.                                    █
                                                              █
        ---                                                   █
                                                              █
        4.3 Broaden fenced-block matching for tool-like       █
        JSON                                                  █
                                                              █
        extractToolNameFencedBlocks currently matches only:   █
                                                              █
            /```(?:javascript|js|json|bash)?\s*\n([\s\S       █
            ]*?)```/gi                                        █
                                                              █
        But many models emit:                                 █
                                                              █
        •                                                     █
        • ts / tsx / ```python                                █
        • or just plain ``` without language


    You already handle no-language due to ?, but          █
        expanding is cheap and harmless because you           █
        try/catch JSON.parse.                                 █
                                                              █
        Change to:                                            █
                                                              █
            const fencedRegex =                               ▇
            /```[\w-]*\s*\n([\s\S]*?)```/gi;                  ▇
                                                              █
        This will catch any language-tagged fence and try     █
        JSON; non-JSON will be safely skipped by the catch.   █
                                                              █
        ---                                                   █
                                                              █
        4.4 Ensure TEXT_MODE formats are fully covered        █
                                                              █
        You instruct models to use:                           █
                                                              █
            ```file: path/to/file.ext                         █
            content                                           █
                                                              █
            --- a/path...                                     █
            +++ b/path...                                     █
            @@ ...                                            █
                                                              █
                                                              █
                                                              █
            Double-check (and, if needed, add) parsing        █
            patterns that cover:                              █
                                                              █
            - Optional whitespace: ```file : path```          █
            or ```file:   path```                             █
            - Missing newline before content                  █
            (occasionally `file: path\ncontent` vs            █
            `file: path\r\ncontent`).                         █
            - Uppercase variants: `FILE:`, `DIFF:`,           █
            etc.                                              █
            - Extra language tags accidentally                █
            inserted by the model, e.g. ```file:              █
            path.ts\n```typescript\n...``` (decide            █
            whether to support or reject that; if you         █
            support, treat the inner ```typescript as         █
            part of content).                                 █
                                                              █
            If any of those are missing, add targeted         █
            regexes; this is the main way open-source         █
            models will try to comply with your prompt.




 █
            Double-check (and, if needed, add) parsing        █
            patterns that cover:                              █
                                                              █
            - Optional whitespace: ```file : path```          █
            or ```file:   path```                             ▄
            - Missing newline before content                  ▄
            (occasionally `file: path\ncontent` vs            █
            `file: path\r\ncontent`).                         █
            - Uppercase variants: `FILE:`, `DIFF:`,           █
            etc.                                              █
            - Extra language tags accidentally                █
            inserted by the model, e.g. ```file:              █
            path.ts\n```typescript\n...``` (decide            █
            whether to support or reject that; if you         █
            support, treat the inner ```typescript as         █
            part of content).                                 █
                                                              █
            If any of those are missing, add targeted         █
            regexes; this is the main way open-source         █
            models will try to comply with your prompt.       █
                                                              █
            **Effort:** S–M (1–2h) depending on               █
            coverage.                                         █
                                                              █
            ---                                               █
                                                              █
            ## 5) stdio / Transport / Streaming Issues        █
                                                              █
            Most of your trouble sounds semantic, not         █
            transport, but a few checks:                      █
                                                              █
            ### 5.1 MCP / stdio framing                       █
                                                              █
            - Ensure your MCP host is using                   █
            **length-prefixed** or similar robust             █
            framing (not just “read until first `}`”)         █
            for tool results and arguments.                   █
            - If you see logs where the raw MCP JSON          █
            shows truncated objects or partial arrays,        █
            add defensive parsing:                            █
              - accumulate chunks until you can               █
            `tolerantJsonParse` a balanced object.            █
              - discard incomplete frames rather than         █
            passing them to executors.


  
Ensure `timeoutMs` are high          █
            enough to let models finish long                  █
            `batch_write` calls.                              █
              - `maxSteps` is not prematurely cutting         █
            off tool-call→response→followup cycles.           █
            For heavy coding sessions, consider               █
            raising `maxSteps` from default (e.g. 10)         █
            to 20–30 for capable models.



     ## 6) Tool Call Format Normalization              █
            (centralized)                                     █
                                                              █
            The biggest leverage change is to make            █
            normalization a **single shared layer**           █
            used everywhere:                                  █
                                                              █
            ### 6.1 Introduce a central                       █
            `normalizeToolCall` pipeline                      █
                                                              █
            Pseudo-API:                                       █
                                                              █
            ```ts                                             █
            interface NormalizedToolCall {                    █
              tool: 'write_file' | 'batch_write' |            █
            'apply_diff' | 'delete_file' | string;            █
              args: any; // already normalized to             █
            expected shape                                    █
            }                                                 █
                                                              █
            function normalizeToolCall(raw: { tool:           █
            string; arguments: any }):                        █
            NormalizedToolCall | null {                       █
              const tool = raw.tool.toLowerCase();            █
              const normalizedArgs =                          █
            normalizeToolArgs(tool, raw.arguments);           █
              // Optionally run a second Zod check            █
            here and return null on fatal problems            █
              return { tool, args: normalizedArgs };          █
            }                                                 █
                                                              █
        Use this in:                                          █
                                                              █
        • MCP host when receiving tool calls.                 █
        • extractJsonToolCalls when parsing text tool         █
          calls.                                              █
        • Your Vercel AI tool-call event handler.             █
                                                              █
        That way:                                             █
                                                              █
        • All paths share the same alias-mapping and          █
          tolerant JSON logic.                                █
        • Metrics can be added in one place (e.g., which      █
          models frequently send filename instead of path).


        • Why not only rely on text-mode?                     █
          Native tool calling is still much more reliable     █
          for strong models. Text-mode is a safety net for    █
          weaker or incompatible ones, so we treat it as a    █
          second phase, not a co-equal interface.             █
                                                              █
        ---                                                   █
                                                              █
        Risks and Guardrails                                  █
                                                              █
        • Over-aggressive aliasing (e.g., interpreting url    █
          as path) could cause unintended writes.             ▇
          Mitigation: keep alias sets narrow and specific     ▇
          (filename, file, filepath only).                    █
        • Tolerant JSON parsing might accept more than you    █
          want.                                               █
          Mitigation:                                         █
            • still run through Zod after normalization,      █
            • reject operations when required fields are      █
              missing even after normalization.               █
        • Self-healing retries could create loops if not      █
          bounded.                                            █
          Mitigation: at most one retry per failed tool       █
          call, with a clear “one-shot fix this JSON”         █
          instruction.                                        █
                                                              █
        ---                                                   █
                                                              █
        When to Consider the “Advanced” Path                  █
                                                              █
        Revisit with more complexity if:                      █
                                                              █
        • After normalization + prompt fixes, you still       █
          see high failure rates (e.g., >5–10% of tool        █
          calls fail for models that should support tools).   █
        • You need strict guarantees about filesystem         █
          correctness for multi-user or                       █
          production-critical work.                           █
        • You start supporting many more diverse providers    █
          with very different function-calling semantics.     █
                                                              █
        At that point, consider:                              █
                                                              █
        • A dedicated mini-LM “JSON/ToolCall repair”          █
          microservice.                                       █
        • Stronger schema-based planning (e.g., generating    █
          an explicit structured plan before executing        █
          tools).                                             █
        • Per-model behavior tuning and model-specific        █
          tool UX.

          an explicit structured plan before executing        █
          tools).                                             █
        • Per-model behavior tuning and model-specific        █
          tool UX.                                            █
                                                              █
        ---                                                   █
                                                              █
        Optional Advanced Path (outline only)                 █
                                                              █
        If you need stronger guarantees later:                █
                                                              █
        1. Introduce a tool-call validator/repairer           ▁
           microservice:                                      ▁
             • Input: raw tool call (name + arg               █
               string/object), target schema.                 █
             • Output: repaired arguments or a validation     █
               error.                                         █
             • Implemented with a small, cheap model          █
               (e.g., gpt-4o-mini / equivalent).              █
        2. Model-specific adapters:                           █
             • Keep a per-model capability registry:          █
               supports function calling? known quirks?       █
             • Adapt prompts and schemas per                  █
               provider/model.                                █
        3. Telemetry-driven auto-tuning:                      █
             • Track per-model:                               █
                   • % tool calls vs text-mode,               █
                   • % failures by type (JSON malformed,      █
                     missing fields, bad paths).              █
             • Auto-adjust: switch models to “text-mode       █
               only” if function calling repeatedly fails;    █
               or tweak schemas/aliases per model.            █
                                                              █
        ---                                                   █
                                                              █
        Effort Summary                                        █
                                                              █
        • Schema preprocessing + alias mapping: M (1–3h)      █
        • Tolerant JSON reuse + parser extensions: S–M        █
          (1–2h)                                              █
        • FC/text-mode gating + prompt tweaks: M (1–3h)       █
        • Central normalizeToolCall + logging: M (2–4h)       █
        • Optional retry/self-healing: M–L (3–6h)             █
                                                              █
        Start with the schema preprocessing + tolerant        █
        JSON reuse + FC/text-mode gating; those are the       █
        highest-leverage steps to cut error rates quickly.
