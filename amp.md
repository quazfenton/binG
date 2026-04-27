

highest-ROI fixes are: (a) centralize tool         
        validation/execution and return structured,            
        recoverable tool errors the model can reason           
        about, and (b) give the model a small precomputed      
        workspace snapshot so it stops guessing paths.         
        Then add a no-progress loop guard and raise the        
        shared step budget.                                    
                                                               
        2. Recommended approach (simple path)                  
                                                               
        1. Fix the split-brain tool execution path first —     
           M (0.5–1d)                                          
             • Right now the pipeline appears to have two      
               owners for tool execution:                      
                   • agent-loop.ts:515-528 passes tools        
                     with execute into the AI SDK              
                   • vercel-ai-streaming.ts:926-964            
                     handles tool-result events                
                   • agent-loop.ts:545-552 executes the        
                     same tool again on tool-call              
             • Pick one execution owner.                       
             • Simplest path: let the AI SDK execute           
               tools, and make agent-loop consume              
               tool-result instead of re-executing on          
               tool-call.                                      
             • This reduces duplicate writes, inconsistent     
               error handling, and weird retry behavior.       
        2. Add a strict tool-call gate with normalization      
           before execution — S-M (2–4h)                      ▇
             • Reuse the existing normalizeToolArgs()         ▇
               logic from vfs-mcp-tools.ts:41-134.             
             • Before any tool executes:                       
                   • normalize aliases (file, filepath,        
                     contents, etc.)                           
                   • validate required fields                  
                   • if args are empty/missing, do not         
                     execute                                   
             • Specifically fix                                
               vercel-ai-streaming.ts:895-908: empty args      
               should become a synthetic failure result,       
               not a real tool invocation.                     
             • Example pattern:

                  const normalized =                          
                   normalizeToolArgs(toolName,                 
                   rawArgs);                                   
                   const missing = required.filter(k           
                   => isBlank(normalized[k]));                 
                   if (missing.length) {                       
                     return {                                  
                       success: false,                         
                       error: {                                
                         code: 'INVALID_ARGS',                 
                         message: `Missing required            
                   arguments: ${missing.join(', ')}`,          
                         retryable: true,                      
                         missing,                              
                         expectedSchema: required,             
                         suggestedNextAction: `Call            
                   ${toolName} again with the required         
                   fields.`,                                   
                       },                                      
                     };                                        
                   }                                           
             • This alone should materially reduce failure     
               rate.                                           
        3. Stop throwing raw JS errors for expected tool       
           failures; return structured tool results            
           instead — M (0.5d)                                  
             • In filesystem-tools.ts, expected failures       
               like:                                           
                   • path not found                            
                   • parent directory missing                  
                   • invalid args                              
                   • blocked bash command                      
             • should return structured results, not just      
               { success: false, error: "File not found" }.    
             • Use a stable envelope like:                     
                   {                                           
                     success: false,                           
                     error: {                                  
                       code: 'PATH_NOT_FOUND',                 
                       message: 'File not found',              
                       retryable: true,                        
                       attemptedPath: 'src/app.ts',            
                       resolvedPath:                           
                   'project/sessions/001/src/app.ts',          
                       suggestedNextTool:                      
                   'list_directory',                           
                       suggestedPaths: ['src/main.ts',         
                   'src/app/page.tsx']                         
                     }                                         
                   }                                           
                                                               

            • Reserve thrown exceptions for true              
               infrastructure faults only.                     
        4. Make hallucinated path errors self-healing — M      
           (0.5–1d)                                            
             • For read_file, write_file, list_directory,      
               and file_exists, when a path fails:             
                   • include attemptedPath                     
                   • include resolvedPath                      
                   • include parentPath                        
                   • include whether parent exists             
                   • include suggestedPaths / nearby           
                     matches                                   
             • Easiest implementation:                         
                   • build a small cached workspace index      
                     once per task from top-level listing      
                     or export                                 
                   • on not-found, suggest nearest             
                     siblings / matching filenames             
             • This directly attacks the “hallucinated         
               file path → repeated failure” pattern.          
        5. Give the model a lightweight precomputed            
           workspace snapshot in buildSystemPrompt() — M       
           (0.5–1d)                                            
             • agent-loop.ts:728-789 is too generic.           
             • Add a capped context block with:                
                   • workspace root                            
                   • currentFile                               
                   • lastAction                                
                   • top-level tree (1–2 levels)               
                   • 10–30 known canonical paths               
                   • maybe recent successful tool outputs      
             • Important: use real current workspace           
               paths, not generic examples.                    
             • Also fix prompt examples to match actual        
               path semantics; right now examples like         
               "toDoApp/src/app.js" are generic and may        
               encourage guessing.                            ▁
             • This is better than forcing the model to       ▁
               always start with list_directory.               
        6. Replace identical-call loop detection with a        
           no-progress guard — M (0.5–1d)                      
             • Current guard in agent-loop.ts:576-607 only     
               catches identical tool+args.                    
             • Track:                                          
                   • consecutive failed steps                  
                   • failure fingerprint = toolName +          
                     errorCode + normalized target             
                     dir/path family

                    dir/path family                           
                   • whether any successful                    
                     read/write/list happened recently         
             • Stop or reprompt when:                          
                   • 3 consecutive failures with no success    
                   • 2+ PATH_NOT_FOUND failures in same        
                     directory family                          
                   • 4 steps with no new file discovered /     
                     no new successful tool result             
             • This catches semantic loops, not just           
               literal repeats.                                
        7. Raise the shared step budget — S (1–2h)             
             • vercel-ai-streaming.ts:396 default maxSteps     
               = 5 is too low as a library default.            
             • In this agent path you already pass             
               this.maxIterations (agent-loop.ts:1215),        
               and constructor default is 10, so the           
               immediate path is better than 5.                
             • But the shared default is still a footgun       
               for other callers/fallbacks.                    
             • Recommendation:                                 
                   • shared default: 12                        
                   • agent default: 12–16 for coding tasks     
                   • pair it with maxConsecutiveFailures       
                     so longer budgets don’t create worse      
                     loops                                     
        8. Add an empty-completion guard — S-M (2–4h)          
             • If the stream ends with:                        
                   • no meaningful text, and                   
                   • no successful tool results                
             • do one automatic recovery turn with a           
               compact diagnostic:                             
                   • “You produced no usable output.           
                     Either provide a final answer or call     
                     one valid tool with non-empty args.”      
             • If that still fails, return a synthesized       
               failure summary instead of success: true        
               with empty output.                             ▂
                                                              ▂
        3. Rationale and trade-offs                            
                                                               
        These changes are the best impact-to-effort            
        because they fix the core failure loop at the          
        boundary where models most often break:                
                                                               
        • Bad tool args → normalize + block                    
        • Bad path guesses → suggest real alternatives         
        • Silent failures → structured results the model       
          can act on



  
        • Generic context → small workspace snapshot           
        • Runaway retries → no-progress guard                  
                                                               
        I would not start with a bigger planner, semantic      
        retriever, or more complicated orchestration. The      
        current system is mostly failing on basic              
        execution hygiene, not lack of intelligence.           
                                                               
        4. Risks and guardrails                                
                                                               
        • Do not dump the whole repo into the prompt.          
            • Cap snapshot by depth + token budget.            
            • Prefer top-level tree + known paths.             
        • Do not throw for recoverable model mistakes.         
            • Throwing hides structure and makes recovery      
              worse.                                           
        • Keep suggestions workspace-scoped.                   
            • No cross-session leakage.                        
        • If you keep manual execution, ensure failed tool     
          results are fed back to the model, not just          
          logged.                                              
        • Longer step budgets need a failure budget.           
            • Increase steps only together with                
              no-progress detection.                           
                                                               
        5. When to consider the advanced path                  
                                                               
        Consider a more advanced design only if, after the     
        above:                                                 
                                                               
        • path/discovery failures are still a major share      
          of task failures                                     
        • large repos make prompt snapshots ineffective        
        • many tasks need >15 tool actions regularly           
        • multi-file generation/editing remains too chatty     
          and fragile                                          
                                                               
        6. Optional advanced path (only if relevant)           
                                                              ▃
        Add higher-level bulk tools to reduce round-trips:    ▃
                                                               
        • read_files                                           
        • batch_write                                          
        • workspace_snapshot                                   
                                                               
        You already have good patterns in vfs-mcp-tools.ts     
        for normalization and bulk operations. Exposing        
        those ideas to this agent path would reduce tool       
        count, latency, and loop surface area. But I’d do      
        that after the boundary fixes above, not before.       

Error message quality - Tool errors return raw      
    │      JS error messages which aren't structured for       
    │      LLM reasoning.                                      
    │   Hallucinated path handling - The filesystem        ▇
    │      tools return {success: false, error: "File not     ▇
    │      found"} but don't tell the model what paths DO      
    │      exist as alternatives.



Review the VFS MCP tool architecture and               
    │   file-edit-parser fallback system for LLM tool          
    │   calling reliability improvements. The system has       
    │   high error rates with many models failing to           
    │   successfully call structured tools. Analyze:           
    │                                                          
    │   1. Tool Schema Design: Are the Zod schemas and         
    │      descriptions optimal for LLM understanding?         
    │   2. Self-Healing Opportunities: What retry/recovery     
    │      mechanisms could be added?                          
    │   3. System Prompt Engineering: Are the                  
    │      TEXT_MODE_TOOL_INSTRUCTIONS optimal?                
    │   4. Parser Robustness: What patterns are the            
    │      file-edit-parser missing?                           
    │   5. stdio/Transport Issues: Could there be              
    │      streaming/chunking issues?                          
    │   6. Tool Call Format Normalization: Can we better       
    │      normalize malformed tool calls before execution?    


Recommended changes                                    
                                                               
        1.1 Use Zod preprocess to normalize args before        
        validation                                             
                                                               
        You already do heavy normalization manually for        
        batch_write in execute. Move that logic into a         
        shared preprocessor so Zod sees normalized objects:    
                                                               
            // shared/normalize-tool-args.ts                   
            export function                                    
            normalizeToolArgs(toolName: string, raw:
        
            'file_path']);                                     
                        const content = alias.call(pf,        ▁
            ['content', 'contents', 'code', 'text',           ▁
            'body']);                                          
                        return { ...pf, path, content          
            };                                                 
                      });                                      
                  }                                            
                  return { ...obj, files };                    
                }                                              
                // ...similar for delete_file,                 
            create_directory if needed                         
                default:                                       
                  return obj;                                  
              }                                                
            }                                                  
                                                               
        Then in your tool definitions:                         
                                                               
            import { normalizeToolArgs } from                  
            './shared/normalize-tool-args';                    
                                                               
            export const writeFileTool = (tool as              
            any)({                                             
              description: 'Create or overwrite a file         
            in the VFS.',                                      
              parameters: z.preprocess(                        
                (raw) =>                                       
            normalizeToolArgs('write_file', raw),              
                z.object({                                     
                  path: z.string().describe('File path         
            to write (relative to workspace/session)'),        
                  content: z.string().describe('Full           
            file content'),                                    
                }),                                            
              ),                                               
              execute: async ({ path, content }) => {          
            /* unchanged */ },                                 
            });                                                
                                                               
        And for batch_write:                                   
                                                               
            parameters: z.preprocess(                          
              (raw) =>                                         
            normalizeToolArgs('batch_write', raw),             
              z.object({                                       
                files: z.array(                                
                  z.object({                                   
                    path: z.string(),

 
                    content: z.string(),                       
                  })                                           
                ).max(50),                                    ▂
              })                                              ▂
            ),                                                 
                                                               
        Impact:                                                
        • Models can use many common aliases (filename,        
          code, etc.) and still succeed.                       
        • Stringified JSON, top-level arrays, and { files:     
          [...] } all work consistently.                       
        • You keep Zod safety but gain fault tolerance.        
                                                               
        Effort: M (1–3h) for core tools.                       
                                                               
        ---                                                    
                                                               
        1.2 Make schemas more LLM-friendly and permissive      
                                                               
        • Use .passthrough() or .strict(false) where extra     
          properties are harmless:                             
                                                               
            z.object({                                         
              path: z.string(),                                
              content: z.string(),                             
            }).passthrough();                                  
                                                               
        • Ensure descriptions are short and explicit;          
          avoid vague wording. E.g.:                           
                                                               
            path: z.string().describe('Relative path           
            like "src/app.tsx" (no URL, no query               
            string).'),                                        
            content: z.string().describe('Complete             
            file contents; do not abbreviate or                
            truncate.'),                                       
                                                               
        • For batch_write, spell out “array of { path,         
          content }” explicitly in the field description       
          and add a one-line JSON example in the tool          
          description.                                         
                                                               
        ---                                                    
                                                               
        2) Self-Healing Opportunities (retry/recovery)         
                                                               
        2.1 Normalize and re-validate on tool-call errors      
                                                               
        Where you handle tool calls in                         
        vercel-ai-streaming.ts (in the tool-call case),        




            
        add a normalization + self-healing attempt before      
        failing:                                               
                                                               
            case 'tool-call': {                               ▃
              onFirstToken();                                 ▃
              const toolName = (chunk as any).toolName;        
              const toolCallId = (chunk as                     
            any).toolCallId;                                   
              let callArgs = (chunk as any).args ||            
            (chunk as any).arguments || {};                    
                                                               
              // 1) Normalize args                             
              const normalized =                               
            normalizeToolArgs(toolName, callArgs);             
                                                               
              // 2) Log diff for debugging                     
              chatLogger.debug('[TOOL-CALL] Normalized         
            args', {                                           
                toolCallId,                                    
                toolName,                                      
                originalKeys: Object.keys(callArgs ||          
            {}),                                               
                normalizedKeys: Object.keys(normalized         
            || {}),                                            
              });                                              
                                                               
              // 3) Replace args before passing to AI          
            SDK / executor                                     
              (chunk as any).args = normalized;                
                                                               
              // continue existing processing...               
            }                                                  
                                                               
        If Zod still throws inside the tool, catch that at     
        the tool-execution layer and:                          
                                                               
        • log a structured error: missing fields, wrong        
          types etc.                                           
        • optionally trigger a single retry completion         
          where you prompt the LLM with:                       
                                                               
          │ The previous tool call for <toolName>              
          │ failed with this error: <short error>.             
          │ Re-emit the same tool call but only with           
          │ valid JSON arguments matching this schema:         
          │ …                                                  
                                                               
        You can do this using a low-temperature follow-up      
        call reusing the conversation plus one system          
        message and the exact error.



                                       
                                                               
        ---                                                    
                                                              ▄
        2.2 Guard against incomplete / empty tool calls       ▄
                                                               
        You’re already logging empty args:                     
                                                               
            if (!hasArgs) {                                    
              chatLogger.error('[TOOL-CALL] ✗ EMPTY            
            args detected - tool likely to fail', ...);        
            }                                                  
                                                               
        Turn that into a recoverable path:                     
                                                               
        • Detect EMPTY args → do not execute the tool.         
        • Instead, treat it as a malformed attempt and:        
            • append an internal assistant message “Tool       
              call failed due to empty arguments” and          
            • send a follow-up LLM call with an explicit       
              instruction to retry the tool call with full     
              arguments.                                       
                                                               
        Even a simple heuristic like “1 retry per              
        toolCallId if args are empty or obviously invalid”     
        will recover a decent share of failures.               
                                                               
        ---                                                    
                                                               
        3) System Prompt Engineering                           
        (TEXT_MODE_TOOL_INSTRUCTIONS)                          
                                                               
        3.1 Avoid mixing function-calling and text-mode in     
        the same call when possible                            
                                                               
        Today:                                                 
                                                               
        • When supportsFC === false: you correctly strip       
          tools and inject TEXT_MODE_TOOL_INSTRUCTIONS.        
        • When supportsFC === undefined: you keep tools        
          and inject text-mode instructions as fallback.       
                                                               
        This second case is very likely causing                
        confusion—models often choose the simpler text         
        format instead of using tools, even if they            
        technically support function calling.                  
                                                               
        Change: make it two-phase for unknown FC capability


                     
        1. First attempt:                                      
             • Use tools only; do not inject text-mode         
               instructions.                                   
             • Track whether any tool calls are produced.      
        2. If:                                                ▅
             • no tool calls are produced, or                 ▅
             • tool calls repeatedly fail Zod validation /     
               execution,                                      
               then:                                           
             • issue a second completion where you:            
                   • remove tools from                         
                     streamOptions.tools, and                  
                   • inject TEXT_MODE_TOOL_INSTRUCTIONS.       
                                                               
        That avoids overloading the model with two             
        competing patterns at once.                            
                                                               
        Effort: M (1–3h).                                      
                                                               
        ---                                                    
                                                               
        3.2 Sharpen the text-mode instructions                 
                                                               
        Your current TEXT_MODE_TOOL_INSTRUCTIONS are good,     
        but a few tweaks will help:                            
                                                               
        • Make it completely unambiguous that                  
          file/diff/mkdir/delete blocks are the only place     
          file ops should appear:                              
                                                               
          Add:                                                 
                                                               
            │ • Do NOT describe file operations in             
            │   plain text.                                    
            │ • Do NOT mix explanations inside file:           
            │   or diff: blocks. Use separate normal           
            │   code fences for explanations.                  
        • Add explicit examples of multiple files              
          (separate blocks):                                   
                                                               
            ```file: src/a.ts                                  
            // content                                         
                                                               
            // content                                         
                                                               
            - Emphasize “one file or directory per             
            block”.                                            
                                                               
            This reduces weird hybrid formats that don’t match any parser pattern.                    
                                                               
            ---                                                
                                                               
            ## 4) Parser Robustness                            
            (file-edit-parser.ts)                              
                                                              ▅
            ### 4.1 Reuse tolerant JSON parsing for           ▅
            JSON-based formats                                 
                                                               
            You already have a robust tolerant parser          
            in `parseBatchWriteFiles` (`tryParseJson`          
            with trailing comma, single quotes,                
            control char handling).                            
                                                               
            **Repurpose that into a shared utility**           
            and use it in:                                     
                                                               
            - `extractJsonToolCalls`                           
            - `extractToolNameFencedBlocks`                    
                                                               
            Example:                                           
                                                               
            ```ts                                              
            // json-tolerant.ts                                
            export function tolerantJsonParse(text:            
            string): unknown {                                 
              // essentially your tryParseJson +               
            sanitizeJsonString                                 
            }                                                  
                                                               
        Then:                                                  
                                                               
            // extractJsonToolCalls                            
            const obj = tolerantJsonParse(jsonStr);            
            if (!obj || typeof obj !== 'object')               
            continue;                                          
                                                               
            // extractToolNameFencedBlocks                     
            const parsed =                                     
            tolerantJsonParse(codeBlock);                      
            if (!parsed || typeof parsed !== 'object')         
            continue;                                          
                                                               
        This will dramatically improve success for:            
                                                               
        • single-quoted JSON                                   
        • trailing commas                                      
        • unescaped newlines inside strings                    
        • JSON-with-“files=” prefixes etc.





      
        • JSON-with-“files=” prefixes etc.                     
                                                               
        Effort: S (≤1h).                                       
                                                               
        ---                                                    
                                                               
        4.2 Support more JSON tool-call variants and           
        aliases                                               ▆
                                                              ▆
        In extractJsonToolCalls:                               
                                                               
        • Right now you require "tool" and "arguments" and     
          expect exact keys like path, content, files.         
          Extend to:                                           
                                                               
            • function, name, or tool_name                     
              (Anthropic/OpenAI variants).                     
            • args or parameters in addition to arguments.     
            • key aliases for path/content as in               
              normalizeToolArgs.                               
                                                               
        Example adjustment:                                    
                                                               
            const toolFieldName = ['tool', 'function',         
            'name', 'tool_name'].find(f => f in obj);          
            const argsFieldName = ['arguments',                
            'args', 'parameters'].find(f => f in obj);         
            const toolName = (toolFieldName && (obj as         
            any)[toolFieldName])?.toLowerCase();               
            const args = argsFieldName ? (obj as               
            any)[argsFieldName] : undefined;                   
                                                               
        Then run the same alias-based field mapping as in      
        normalizeToolArgs.                                     
                                                               
        ---                                                    
                                                               
        4.3 Broaden fenced-block matching for tool-like        
        JSON                                                   
                                                               
        extractToolNameFencedBlocks currently matches only:    
                                                               
            /```(?:javascript|js|json|bash)?\s*\n([\s\S        
            ]*?)```/gi                                         
                                                               
        But many models emit:                                  
                                                               
        •                                                      
        • ts / tsx / ```python                                 
        • or just plain ``` without language


    You already handle no-language due to ?, but           
        expanding is cheap and harmless because you            
        try/catch JSON.parse.                                  
                                                               
        Change to:                                             
                                                               
            const fencedRegex =                               ▇
            /```[\w-]*\s*\n([\s\S]*?)```/gi;                  ▇
                                                               
        This will catch any language-tagged fence and try      
        JSON; non-JSON will be safely skipped by the catch.    
                                                               
        ---                                                    
                                                               
        4.4 Ensure TEXT_MODE formats are fully covered         
                                                               
        You instruct models to use:                            
                                                               
            ```file: path/to/file.ext                          
            content                                            
                                                               
            --- a/path...                                      
            +++ b/path...                                      
            @@ ...                                             
                                                               
                                                               
                                                               
            Double-check (and, if needed, add) parsing         
            patterns that cover:                               
                                                               
            - Optional whitespace: ```file : path```           
            or ```file:   path```                              
            - Missing newline before content                   
            (occasionally `file: path\ncontent` vs             
            `file: path\r\ncontent`).                          
            - Uppercase variants: `FILE:`, `DIFF:`,            
            etc.                                               
            - Extra language tags accidentally                 
            inserted by the model, e.g. ```file:               
            path.ts\n```typescript\n...``` (decide             
            whether to support or reject that; if you          
            support, treat the inner ```typescript as          
            part of content).                                  
                                                               
            If any of those are missing, add targeted          
            regexes; this is the main way open-source          
            models will try to comply with your prompt.




  
            Double-check (and, if needed, add) parsing         
            patterns that cover:                               
                                                               
            - Optional whitespace: ```file : path```           
            or ```file:   path```                             ▄
            - Missing newline before content                  ▄
            (occasionally `file: path\ncontent` vs             
            `file: path\r\ncontent`).                          
            - Uppercase variants: `FILE:`, `DIFF:`,            
            etc.                                               
            - Extra language tags accidentally                 
            inserted by the model, e.g. ```file:               
            path.ts\n```typescript\n...``` (decide             
            whether to support or reject that; if you          
            support, treat the inner ```typescript as          
            part of content).                                  
                                                               
            If any of those are missing, add targeted          
            regexes; this is the main way open-source          
            models will try to comply with your prompt.        
                                                               
            **Effort:** S–M (1–2h) depending on                
            coverage.                                          
                                                               
            ---                                                
                                                               
            ## 5) stdio / Transport / Streaming Issues         
                                                               
            Most of your trouble sounds semantic, not          
            transport, but a few checks:                       
                                                               
            ### 5.1 MCP / stdio framing                        
                                                               
            - Ensure your MCP host is using                    
            **length-prefixed** or similar robust              
            framing (not just “read until first `}`”)          
            for tool results and arguments.                    
            - If you see logs where the raw MCP JSON           
            shows truncated objects or partial arrays,         
            add defensive parsing:                             
              - accumulate chunks until you can                
            `tolerantJsonParse` a balanced object.             
              - discard incomplete frames rather than          
            passing them to executors.


  
Ensure `timeoutMs` are high           
            enough to let models finish long                   
            `batch_write` calls.                               
              - `maxSteps` is not prematurely cutting          
            off tool-call→response→followup cycles.            
            For heavy coding sessions, consider                
            raising `maxSteps` from default (e.g. 10)          
            to 20–30 for capable models.



     ## 6) Tool Call Format Normalization               
            (centralized)                                      
                                                               
            The biggest leverage change is to make             
            normalization a **single shared layer**            
            used everywhere:                                   
                                                               
            ### 6.1 Introduce a central                        
            `normalizeToolCall` pipeline                       
                                                               
            Pseudo-API:                                        
                                                               
            ```ts                                              
            interface NormalizedToolCall {                     
              tool: 'write_file' | 'batch_write' |             
            'apply_diff' | 'delete_file' | string;             
              args: any; // already normalized to              
            expected shape                                     
            }                                                  
                                                               
            function normalizeToolCall(raw: { tool:            
            string; arguments: any }):                         
            NormalizedToolCall | null {                        
              const tool = raw.tool.toLowerCase();             
              const normalizedArgs =                           
            normalizeToolArgs(tool, raw.arguments);            
              // Optionally run a second Zod check             
            here and return null on fatal problems             
              return { tool, args: normalizedArgs };           
            }                                                  
                                                               
        Use this in:                                           
                                                               
        • MCP host when receiving tool calls.                  
        • extractJsonToolCalls when parsing text tool          
          calls.                                               
        • Your Vercel AI tool-call event handler.              
                                                               
        That way:                                              
                                                               
        • All paths share the same alias-mapping and           
          tolerant JSON logic.                                 
        • Metrics can be added in one place (e.g., which       
          models frequently send filename instead of path).


        • Why not only rely on text-mode?                      
          Native tool calling is still much more reliable      
          for strong models. Text-mode is a safety net for     
          weaker or incompatible ones, so we treat it as a     
          second phase, not a co-equal interface.              
                                                               
        ---                                                    
                                                               
        Risks and Guardrails                                   
                                                               
        • Over-aggressive aliasing (e.g., interpreting url     
          as path) could cause unintended writes.             ▇
          Mitigation: keep alias sets narrow and specific     ▇
          (filename, file, filepath only).                     
        • Tolerant JSON parsing might accept more than you     
          want.                                                
          Mitigation:                                          
            • still run through Zod after normalization,       
            • reject operations when required fields are       
              missing even after normalization.                
        • Self-healing retries could create loops if not       
          bounded.                                             
          Mitigation: at most one retry per failed tool        
          call, with a clear “one-shot fix this JSON”          
          instruction.                                         
                                                               
        ---                                                    
                                                               
        When to Consider the “Advanced” Path                   
                                                               
        Revisit with more complexity if:                       
                                                               
        • After normalization + prompt fixes, you still        
          see high failure rates (e.g., >5–10% of tool         
          calls fail for models that should support tools).    
        • You need strict guarantees about filesystem          
          correctness for multi-user or                        
          production-critical work.                            
        • You start supporting many more diverse providers     
          with very different function-calling semantics.      
                                                               
        At that point, consider:                               
                                                               
        • A dedicated mini-LM “JSON/ToolCall repair”           
          microservice.                                        
        • Stronger schema-based planning (e.g., generating     
          an explicit structured plan before executing         
          tools).                                              
        • Per-model behavior tuning and model-specific         
          tool UX.

          an explicit structured plan before executing         
          tools).                                              
        • Per-model behavior tuning and model-specific         
          tool UX.                                             
                                                               
        ---                                                    
                                                               
        Optional Advanced Path (outline only)                  
                                                               
        If you need stronger guarantees later:                 
                                                               
        1. Introduce a tool-call validator/repairer           ▁
           microservice:                                      ▁
             • Input: raw tool call (name + arg                
               string/object), target schema.                  
             • Output: repaired arguments or a validation      
               error.                                          
             • Implemented with a small, cheap model           
               (e.g., gpt-4o-mini / equivalent).               
        2. Model-specific adapters:                            
             • Keep a per-model capability registry:           
               supports function calling? known quirks?        
             • Adapt prompts and schemas per                   
               provider/model.                                 
        3. Telemetry-driven auto-tuning:                       
             • Track per-model:                                
                   • % tool calls vs text-mode,                
                   • % failures by type (JSON malformed,       
                     missing fields, bad paths).               
             • Auto-adjust: switch models to “text-mode        
               only” if function calling repeatedly fails;     
               or tweak schemas/aliases per model.             
                                                               
        ---                                                    
                                                               
        Effort Summary                                         
                                                               
        • Schema preprocessing + alias mapping: M (1–3h)       
        • Tolerant JSON reuse + parser extensions: S–M         
          (1–2h)                                               
        • FC/text-mode gating + prompt tweaks: M (1–3h)        
        • Central normalizeToolCall + logging: M (2–4h)        
        • Optional retry/self-healing: M–L (3–6h)              
                                                               
        Start with the schema preprocessing + tolerant         
        JSON reuse + FC/text-mode gating; those are the        
        highest-leverage steps to cut error rates quickly.

------
CURRENT ARCHITECTURE SUMMARY

    web/app/api/chat/route.ts, which serves as the         
        primary orchestration point for both "V1" (api cals for   
        completion, manually wired for agentic action and tool calling) and "V2" (pre-created   cli agent engines) requests.                                     
                                                               
        Depending on the request type and agentMode, the       
        assembly happens in different places:                  
                                                               
        1. Orchestration & Assembly                            
           (web/app/api/chat/route.ts):

             • Classification: It uses classifyRequest         
               (L145) to decide between V1 and V2 paths.       
             • System Prompt Assembly: It builds the           
               system prompt by combining a base prompt        
               with modifiers using applyPromptModifiers       
               (L57).                                          
             • V2/Agentic Path: Calls                          
               processUnifiedAgentRequest (L1221) which        
               delegates to specialized executors.             
        2. Streaming Handler                                   
           (web/lib/chat/vercel-ai-streaming.ts):              
             • This file contains the core                     
               streamWithVercelAI function (L977) which        
               calls the AI SDK's streamText.                  
             • It handles tool definitions (L1031), system     
               prompt injection (L1030), and message           
               history (L1010).                                
             • It includes a fallback mechanism (L1128)        
               that re-assembles the prompt and tools for      
               a different model if the primary one fails.     
        3. Advanced Orchestrator                               
           (packages/shared/agent/orchestration/agent-orche    
           strator.ts):                                        
             • For multi-step autonomous tasks, this file      
               uses generateText (L480) within a               
               "Plan-Act-Verify" loop.                         
             • It assembles a hardcoded system prompt          
               (L475) with the conversation history and        
               task.                                           
                                                               
        Relevant files:                                        
        • web/app/api/chat/route.ts#L1163-L1412 — Main         
          POST handler orchestrating the streaming and         
          tool execution.                                      
        • web/lib/chat/vercel-ai-streaming.ts#L977-L1310 —     
          The final implementation where streamText is         
          called with tools and system prompt.                 
        • packages/shared/agent/orchestration/agent-orchest    
          rator.ts#L462-L505 — Autonomous loop assembly        
          using generateText.                                  
        • packages/shared/agent/unified-router.ts#L192-L282    
           — Routing logic that prepares the                   
          UnifiedAgentConfig.                                  
        • packages/shared/agent/orchestration-mode-handler.    
          ts#L194-L223 — Assembly of system prompts with       
          modifiers for the unified agent.                     
        • web/app/api/chat/chat-helpers.ts#L19-L46 — Zod       
          schema defining the expected structure of            
          messages and tools.







       Tool execution error handling and configuration        
        are primarily managed through the Vercel AI SDK        
        integration, with several layers of fallbacks and      
        retry logic.                                           
                                                               
        1. Tool Result Processing & Error Handling             
        Tool results are processed in the streaming loop       
        where successes and failures are caught and            
        normalized before being fed back to the model as       
        tool role messages.                                    
        • Vercel AI SDK Stream: Handles tool-call and          
          tool-result events, logging failures and             
          successes.                                           
            • web/lib/chat/vercel-ai-streaming.ts#L926-L966    
        • Agent Loops: Implement try/catch blocks around       
          tool.execute() to capture errors and return a        
          failure result to the LLM.                           
            • web/lib/orchestra/mastra/agent-loop.ts#L573-L    
            







      
              619 (Standard execution)                         
            • web/lib/orchestra/mastra/agent-loop.ts#L1096-    
              L1105 (Fallback execution)                       
            • web/lib/orchestra/stateful-agent/agents/state    
              ful-agent.ts#L1547-L1569                         
        • Error Normalization: ToolContextManager uses a       
          unified error handler to categorize errors as        
          retryable or validation-related.                     
            • web/lib/tools/tool-context-manager.ts#L177-L1    
              93                                               
                                                               
        2. Retries & Self-Healing                              
        The system uses both automated loop detection and      
        model rotation for retries.                            
        • Loop Detection: If a tool fails twice with the       
          same arguments, the agent stops to prevent           
          infinite loops.                                      
            • web/lib/orchestra/mastra/agent-loop.ts#L581-L    
              608                                              
        • Model Rotation (Retry Logic): When a tool fails      
          or an empty response is received, the system can     
          retry using a different model (e.g., switching       
          from a faster model to a more capable one).          
            • web/app/api/chat/route.ts#L433-L534              
        • Client-side Retries: UI hooks provide a retry        
          function for retryable tool errors.                 ▁
            • web/hooks/use-tool-integration.ts#L160-L165     ▁
                                                               
        3. Max Steps Configuration                             
        maxSteps (often defaulting to 10-15) is configured     
        at multiple levels:                                    
        • Global/Env: process.env.AI_SDK_MAX_STEPS or          
          process.env.OPENCODE_MAX_STEPS.                      
        • API Routes: Configured in chat and agent             
          endpoints.                                           
            • web/app/api/chat/route.ts#L1086                  
            • web/app/api/agent/stateful-agent/route.ts#L43    
              -L47                                             
        • Service Defaults:                                    
            • unified-agent-service.ts: Defaults vary          
              between 15-25 depending on the agent type.       
            • web/lib/orchestra/unified-agent-service.ts#L5    
              36-L623








      
        1. Orchestration Layer (The "Act" Phase)               
        The most robust implementation is in                   
        AgentOrchestrator, which uses a while(true) loop       
        to handle the "Act" phase of a Plan-Act-Verify         
        cycle. It uses an IterationController to enforce       
        maxSteps and token limits.                             
        • packages/shared/agent/orchestration/agent-orchest    
          rator.ts#L343-L363 — The main while loop that        
          calls the LLM, checks iteration limits, and          
          executes tools.                                      
        • web/lib/orchestra/unified-agent-service.ts#L1280-    
          L1296 — Configures the orchestrator with             
          maxIterations (defaulting to 10 or 15).              
                                                               
        2. LLM Provider Implementations                        
        Individual providers implement their own loops         
        when not using the centralized orchestrator:           
        • web/lib/sandbox/providers/gemini-provider.ts#L40-    
          L96 — A for loop that iterates up to maxSteps,       
          handling Gemini's specific tool response format.     
        • web/lib/orchestra/stateful-agent/agents/stateful-    
          agent.ts#L1537-L1550 — Uses Vercel AI SDK's          
          streamText with its built-in maxSteps support.       
                                                               
        3. Execution & Process Loops                           
        Low-level execution loops manage the interaction       
        between the model's tool calls and the sandbox:        
        • web/lib/sandbox/spawn/opencode-spawn.ts#L141-L197    
           — Listens to a process's stdout, parses tool        
          calls, executes them, and writes results back to     
          stdin until maxSteps is hit.                         
        • packages/shared/agent/services/agent-worker/src/o    
          pencode-engine.ts#L279-L301 — Managed event          
          queue loop for the OpenCode engine.                  
                                                               
        4. Legacy/Simplified Loops                             
        • web/lib/orchestra/agent-loop.ts#L84-L95 — A          
          simplified wrapper calling a provider's              
          runAgentLoop with a hardcoded maxSteps: 15.





1. Error Catching & Message Composition                
        Errors are typically caught in the agent loop,         
        converted into a structured ToolResult, and then       
        stringified into a message with the tool role.         
                                                               
        • Manual Agent Loop (Mastra): In agent-loop.ts,        
          the loop catches errors for both standard and        
          fallback tool executions. It formats the result      
          (including success/failure status) and pushes it     
          to the conversationHistory with role: 'tool'.        
            • web/lib/orchestra/mastra/agent-loop.ts#L573-L    
              


   
              598 - Catches execution errors and formats a     
              "STOPPED" message if loops are detected.         
            • web/lib/orchestra/mastra/agent-loop.ts#L388-L    
              396 - Composes the tool role message from        
              the result.                                      
        • Agent Orchestrator: In the shared                    
          agent-orchestrator.ts, errors are caught during      
          the executeToolWithHealing phase and converted       
          into a structured result using buildToolResult.      
            • packages/shared/agent/orchestration/agent-orc    
              hestrator.ts#L380-L395 - Catching errors and     
              pushing to history with role: 'tool'.            
        • Unified Error Handling: The UnifiedErrorHandler      
          provides standardized error categorization           
          (Validation, Auth, etc.) and is re-exported for      
          tool usage.                                          
            • web/lib/utils/error-handler.ts#L380-L420 -       
              Logic for normalizing errors into                
              LLM-readable strings.                            
                                                               
        2. Hallucinated Path & Path-Not-Found Handling         
        The system uses heuristics and loop detection to       
        handle cases where an LLM provides a non-existent      
        path.                                                  
                                                               
        • Loop Detection: agent-loop.ts tracks                 
          failedToolCalls to detect if the LLM is              
          repeatedly trying the same invalid path,             
          specifically mentioning that "The file may not       
          exist or path may be incorrect."                     
            • web/lib/orchestra/mastra/agent-loop.ts#L576-L    
              598                                              
        • Heuristic Error Detection: The orchestrator and      
          bash self-healing components scan error messages     
          for "does not exist" or "path not found" to          
          trigger remediation or specific feedback.            
            • packages/shared/agent/orchestration/agent-orc    
              hestrator.ts#L157-L165 - Heuristic check for     
              path not found and enoent.                       
            • web/lib/chat/bash-self-heal.ts#L279-L285 -       
              Regex matching for "No such file" or "does       
              not exist" in bash output.                       
        • Tool-Level Verification: Individual tools like       
          file_exists and read_file explicitly check for       
          "not found" errors and return structured exists:     
          false or error objects.                              
            • web/lib/orchestra/mastra/tools/filesystem-too    
              ls.ts#L320-L355 - file_exists tool              ▄
              implementation.
***web/ (web version, main)
desktop/ (desktop Tauri version; uses hybrid web frontend & some nextjs endpoints + Rust/Tauri commands for Filesystem etc. )
packages/shared/cli  (CLI version, runs on desktop with local fs similar to desktop/ version but uses engineering like parsing response for file edits and piping commands to/from LLM for engineered agency etc. via node similar to web )
These 3 are meant to be modular and use web/ implementation with some abstraction for the latter 2 to have modularity within same 'base' system
 ***



