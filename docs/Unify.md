# Problem statement
Agent execution, tool integration, and code/file side effects currently travel through mixed transports: canonicalized tool-invocation objects, provider-specific result shapes, message-parsed command blocks, and CLI-specific parsed outputs. This makes UI rendering, preview/apply flows, and agent orchestration brittle because `ToolInvocation` is mostly a late normalization target instead of the required backend contract.
## Current state
The repo already has a canonical UI-facing tool invocation type in `lib/types/tool-invocation.ts:11` plus `normalizeToolInvocation()` / `normalizeToolInvocations()` in `lib/types/tool-invocation.ts:29-55`. That contract is consumed in `components/tool-invocation-card.tsx:6-10` and applied in `lib/api/unified-response-handler.ts:95-97` and `lib/api/priority-request-router.ts:1016-1018`. However, producers still emit incompatible shapes: the priority router emits `toolCalls`/`toolResults` plus synthesized invocations in `lib/api/priority-request-router.ts:1010-1019`; Mastra emits near-canonical invocation records in `lib/mastra/agent-loop.ts:208-214` and `284-290`; V2 streams its own `tool_invocation` event shape in `lib/agent/v2-executor.ts:146-168`; and the OpenCode path parses CLI JSON into `bashCommands`, `fileChanges`, and freeform response text in `lib/api/opencode-engine-service.ts:470-557`.
Message parsing is still a primary execution mechanism in several places. `lib/api/unified-response-handler.ts:192-200` extracts command blocks from assistant text, `lib/code-parser.ts:34-63` converts raw text into edits heuristically, `lib/code-parser.ts:107-169` parses fenced code blocks and shell commands, and `lib/api/priority-request-router.ts:1105-1112` extracts tool intent from `<tool ...>` tags embedded in message content. Context pack generation exists in `lib/virtual-filesystem/context-pack-service.ts:107-158`, but the sampled execution paths do not treat it as the universal agent-context ingress; V2 simply prepends `options.context` as raw text in `lib/agent/v2-executor.ts:80-82`, while Mastra constructs its own prompt history in `lib/mastra/agent-loop.ts:169-177`.
## Proposed changes
Define a small canonical execution transport layer with separate event families for tool lifecycle and side effects. Keep `ToolInvocation` as the canonical tool lifecycle record, but extend it with explicit provenance metadata that producers can fill directly rather than infer later. Add a sibling effect/event type for file writes, patches, deletes, reads, shell commands, stdout/stderr, and sandbox or VFS sync operations. The UI and response handler should consume these canonical event arrays directly, while legacy fields such as `toolCalls`, `toolResults`, parsed command blocks, and parsed code edits remain compatibility inputs during migration.
Create a shared execution envelope for all first-party agent paths. That envelope should carry task text, a normalized context payload, execution scope, available tool namespaces, and policy/permission metadata. The context-pack service should become the standard implementation used to populate workspace context when file-backed context is needed, instead of each executor injecting its own ad hoc prompt fragments. This keeps context generation separate from prompt formatting while making agent inputs consistent.
Migrate producers in phases. First, make the priority router, Mastra, and V2 emit canonical tool invocation arrays directly and stop depending on `toolCalls`/`toolResults` as the primary contract. Next, add canonical effect emission for V2 and OpenCode/nullclaw-style file and shell outputs so previews and apply flows can read structured artifacts instead of assistant text. Then update the unified response handler to prefer canonical tool/effect events and treat command parsing only as a legacy fallback. Finally, demote `lib/code-parser.ts` and the router’s inline `<tool ...>` parser behind an explicit compatibility boundary so message parsing is only used when an upstream agent cannot provide structured events.
Keep integration-provider concerns separate from execution-event concerns. Registry/provider code in `lib/tools/registry.ts:1-220` and provider typing in `lib/tool-integration/types.ts:3-69` should continue to decide which backend executes a tool, but provider identity should be attached as provenance metadata on canonical invocation/effect events rather than encoded indirectly through naming conventions or response-shape inference. This preserves support for Composio, Nango, Arcade, MCP, Smithery, and similar integrations without conflating provider selection with UI transport.
## Migration order
Start with the transport types and response handler because they define the compatibility boundary. Then update producer paths in this order: `lib/api/priority-request-router.ts`, `lib/mastra/agent-loop.ts`, `lib/agent/v2-executor.ts`, and `lib/api/opencode-engine-service.ts`. Once those producers emit canonical events, update preview/apply consumers and only then retire primary reliance on command-block parsing and code-message parsing. This sequence minimizes breakage because the unified response handler can accept both old and new shapes during the transition.
----------------------------------


[TO-DO]:
1. **Fix current lint blocker introduced in touched path**  
   In `lib/api/unified-response-handler.ts`, remove unnecessary regex escapes at the flagged line (the `no-useless-escape` error around line ~210) so targeted lint passes.

2. **Upgrade `UnifiedResponse` typing to canonical contract**  
   - Change `toolInvocations?: any[]` to `toolInvocations?: ToolInvocation[]`  
   - Import `ToolInvocation` type from `lib/types/tool-invocation.ts`  
   - Keep `toolCalls` as legacy optional field for compatibility.

3. **Emit richer canonical invocation metadata in priority router** (`lib/api/priority-request-router.ts`)  
   Wherever `toolInvocations` are synthesized, pass provenance fields into normalizer input:
   - `provider` (if known; fallback `composio`/`mcp`/`unknown`)
   - `sourceSystem: 'priority-router'`
   - `requestId`
   - `conversationId`
   - Preserve `args`, `result`, `toolName`/`name`.

4. **Add one canonical helper in priority router for all tool outputs**  
   Create a local helper (e.g. `buildCanonicalToolInvocation`) used by:
   - unified registry success path
   - unified registry failure/error path (if tool name known)
   - composio fallback success path  
   This reduces shape drift and duplicated object literals.

5. **Prefer canonical path in unified response handler; keep fallback**  
   You already added extraction order. Next tighten to:
   - first accept already-canonical `response.data.toolInvocations`
   - normalize only if needed (legacy shapes)
   - keep `response.data.toolResults` fallback until producer migration is complete.

6. **Add focused tests (cheap + high value)**  
   Create/extend tests for:
   - `normalizeToolInvocation` metadata extraction (`provider`, `sourceAgent`, `sourceSystem`, `requestId`, `conversationId`, `rawState`)
   - `UnifiedResponseHandler.extractToolInvocations` precedence order  
   Use small unit tests only (no broad test suite).

7. **Run only targeted validation commands**  
   - `npx eslint lib/types/tool-invocation.ts lib/api/unified-response-handler.ts lib/api/priority-request-router.ts`
   - run only the specific test file(s) you add (avoid full `npm run lint` / full test suite).

8. **Stop after router migration (don’t start V2/Mastra yet)**  
   Commit point for this phase should be:  
   - canonical type upgraded  
   - unified handler canonical-first  
   - priority router emitting metadata-rich canonical invocations  
   - tests green for changed units



[PROGRESS] — I implemented this continuation in minimal scope to take over easily.

Implemented changes

•  lib/api/unified-response-handler.ts
◦  Imported canonical type: ToolInvocation
◦  Updated UnifiedResponse.data.toolInvocations to ToolInvocation[] (from any[])
◦  Kept canonical-first extraction path you requested
◦  Fixed the parser regex/replacement escapes in request_files extraction to remove lint errors
•  lib/api/priority-request-router.ts
◦  Added helper methods:
▪  buildCanonicalToolInvocations(...)
▪  buildCanonicalToolInvocationRecord(...)
◦  Updated unified-registry tool success path to emit metadata-rich canonical invocation entries:
▪  includes provider, sourceSystem: 'priority-router', requestId, conversationId
◦  Updated Composio success path to synthesize toolInvocations from toolCalls via the same canonical helper path
•  New focused unit tests
◦  __tests__/api/tool-invocation-normalization.test.ts
▪  verifies metadata extraction (provider/sourceAgent/sourceSystem/requestId/conversationId/rawState)
◦  __tests__/api/unified-response-handler.test.ts
▪  verifies precedence: data.toolInvocations wins over messageMetadata, metadata, and toolResults



Validation run (targeted only)

•  npx eslint ... on only changed files:
◦  0 errors, warnings remain repo-style (any, strictNullChecks, etc.)
•  npx vitest run "__tests__/api/tool-invocation-normalization.test.ts" "__tests__/api/unified-response-handler.test.ts":
◦  2/2 tests passed


 (next tiny steps)

1. In priority-request-router.ts, replace remaining ||-style fallbacks in touched helper callsites with ?? where safe (reduces warnings).
2. Optionally add one more unit test for Composio mapping fallback name (composio-tool-${index+1}).
3. Then move to next migration phase (V2/Mastra producers) without touching broad lint baseline.
PROGRESS

