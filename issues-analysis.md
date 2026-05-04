# binG Issues Analysis and Proposed Fixes

## Executive Summary
This document analyzes 15+ issues reported in `prompt.md`, tracing root causes through code investigation of `unified-agent-service.ts` and related files, then proposes fixes.

---

## Issue 0: `Cannot read properties of undefined (reading 'length')` + `circuitState: CLOSED`

### Error Log
```
EXECUTION FAILED: Cannot read properties of undefined (reading 'length')
circuitState: CLOSED (even though this was first message)
```

### Root Cause Analysis
The error occurs in `unified-agent-service.ts` when `config.userMessage.length` is accessed without checking if `userMessage` exists:

- **Line 749**: `userMessageLength: config.userMessage.length` in `runV2NativeMode`
- Other occurrences at lines 844, 1105, 599, 483 all assume `userMessage` exists

The `circuitState: CLOSED` comes from Vercel AI SDK's circuit breaker in `vercel-ai-streaming.ts` - it's a separate issue where the model/provider was previously marked as failing and hasn't been tried on first request.

### Proposed Fixes
1. **Add null check for userMessage** in `runV2NativeMode` and other switch cases:
```typescript
userMessageLength: config.userMessage?.length || 0,
```

2. **Reset circuit breaker state tracking** - track session-based circuit state to clear on new conversation session or ensure circuit considers first request differently.

---

## Issue 3: Database Migration 015 Failure - `no such table: main.users`

### Error Log
```
Migration 015 failed: SqliteError: error in view user_stats: no such table: main.users
```

### Root Cause Analysis
The migration `015_users_id_to_text.sql` recreates but uses `DROP VIEW IF EXISTS user_stats` AFTER table operations. The view references the old `users` table which gets dropped mid-migration, attempting to recreate at end but fails if earlier migrations didn't create base table.

The migration runs AFTER initial schema creation but expects base tables that may not exist in fresh database.

### Proposed Fixes
1. **Add transaction wrapper** to migration to ensure atomicity
2. **Check if base tables exist** before converting
3. **Separate migration** - one for schema creation, another for view creation

---

## Issue 3b: Server Restarts on File Edits Causing `database is locked`

### Error Log
```
Failed to initialize base schema: SqliteError: database is locked
Migration 015 failed: SqliteError: database is locked
```

### Root Cause Analysis
When dev server detects file changes, it restarts and tries to initialize DB while another connection holds the lock. SQLite with file-based locking doesn't support multiple writers.

### Proposed Fixes
1. **Add retry logic with exponential backoff** in `initializeSchemaSync`
2. **Use WAL mode** for better concurrency: `PRAGMA journal_mode=WAL;`
3. **Close all DB connections** before restarting or use separate process for migrations

---

## Issue 2: Model Not Using Tools / ROUTING_METADATA Not Parsed

### Observed Behavior
- Model went straight to text response, didn't use tools
- `streamOptionsHasTools: false` 
- `ROUTING_METADATA` displayed as literal text in response

### Error Log
```
config.tools?.length: 19
streamOptionsHasTools: false
```

### Root Cause Analysis
1. **Tools not reaching LLM**: In `runV1ApiWithTools` at line 1718, `config.tools?.length` shows 19 tools exist but `streamOptionsHasTools: false` indicates tools weren't passed to the API call.

2. **ROUTING_METADATA not parsed**: The `[ROUTING_METADATA]` section should be parsed server-side and used to inject role prompts. But it's returning as literal text means either:
   - Parser is not extracting it from response
   - Client isn't processing the metadata

3. **Task Classifier still runs**: Despite being disabled in favor of in-LLM role selection, it's still being called with wrong provider/model.

### Proposed Fixes
1. **Debug `runV1ApiWithTools`**: Add logging to verify tools array is passed to `generateText`/`generateObject`
2. **Add ROUTING_METADATA parser**: Extract from response in `vercel-ai-streaming.ts` or `unified-agent-service.ts`
3. **Wrap response processing**: Remove metadata sections from display text

---

## Issue 3 (Full LLM Response in UI): `[Initial Response]` / `[ROUTING_METADATA]` Displayed

### Root Cause
Response contains markers that should be parsed服务端 but are displayed in UI as literal text.

### Proposed Fixes
1. **Add marker parsing in message handling**:
```typescript
// In response handling
const cleanedText = responseText
  .replace(/^###?\s*Initial Response.*?\n---/g, '')
  .replace(/\[ROUTING_METADATA\][\s\S]*?```/g, '')
  .trim();
```

---

## Issue 6: Filesystem Explorer Wrong Path / ownerID

### Observed
```
listDirectory: cache hit for "project/sessions/006"
listDirectory: loaded "C:\Users\ceclabs\Downloads\binG\web/project/sessions/006", 0 entries
owner: 006
```

### Root Cause Analysis
1. **Wrong path**: The path combines web scope prefix with local filesystem, creatinghybrid path. Files are served to the client path but actual files don't exist.

2. **owner ID shows 006**: This is likely the session ID not the user UUID. In `code-preview-panel.tsx:1597`, `sessionsRoot = "project/sessions"` is hardcoded when VFS should use user-specific session paths.

### Proposed Fixes
1. **Separate web paths from local paths**: Use clean VFS root separate from session paths
2. **Use correct ownerID**: Pass correct user UUID when initializing VFS, not session ID

---

## Issue 7: Vercel Provider Model Prefixed with `vercel:` 

### Error Log
```
model: 'vercel:xai/grok-3-mini-fast'
```

### Root Cause Analysis
In `llm-providers.ts` line 468-471, models defined with `vercel:` prefix like `vercel:xai/grok-3`. When these are used, they're passed directly causing double-prefix.

The issue occurs because `vercel:xai/grok-3-mini-fast` is stored in providers but Vercel provider expects just the model name after `/`.

### Proposed Fixes
1. **Strip `vercel:` prefix** when constructing model string:
```typescript
// In getVercelModel or before API call
const cleanModel = model.startsWith('vercel:') ? model.slice(6) : model;
```

---

## Issue 8: Task Classifier Uses Wrong Provider

### Error Log
```
[TaskClassifier] Semantic analysis failed, using fallback
Error: Incorrect API key provided
```

### Root Cause Analysis
Looking at `task-classifier.ts` line 361-376, the classifier uses Vercel's AI SDK to call `generateObject` but uses `model = createMistral(...)` as fallback. However, it also has logic at line 356 that uses `fastModelProvider` which may be `vercel` and then incorrectly uses the wrong API key.

### Proposed Fixes
1. **Use primary configured provider** for classifier
2. **Add error handling** to fall back to simpler heuristic when classification fails

---

## Issue 9: Wrong Fallback / Circuit CLOSED

### Root Cause
Similar to #0 - circuit breaker tracks failures but wrongly marks provider as failed early. The fallback chain shows `visitedModes: [ 'v1-agent-loop' ]` but fallback should allow one retry per mode first.

### Proposed Fixes
1. **Fix circuit breaker reset**: Clear circuit state on new conversation session
2. **Immediate fallback**: On first-mode failure, try fallback without marking circuit closed

---

## Issue 10: Vercel Sends to OpenAI URL / Wrong Model

### Error Log
```
url: 'https://api.vercel.com/v1/responses'
model: 'vercel:xai/grok-3-mini-fast'
statusCode: 404
responseBody: '{"error":{"code":"not_found","message":"The requested API endpoint was not found."}}'
```

### Root Cause Analysis
Looking at `vercel-ai-streaming.ts` lines 423-427, when provider is `vercel`:
```typescript
case 'vercel': {
  const openai = createOpenAI({
    apiKey: apiKey || currentEnv.VERCEL_API_KEY,
    baseURL: baseURL || currentEnv.VERCEL_BASE_URL || 'https://api.vercel.com/v1',
  });
  return openai(model);
}
```

The problem: `createOpenAI(model)` creates an OpenAI-compatible Model object that sends requests through OpenAI-style endpoints. But xAI Grok models via Vercel need `/models/{model}/v1` paths, not `/responses` etc.

Also xAI isn't in the switch case so falls through to `OPENAI_COMPATIBLE_PROVIDERS` lookup which has wrong structure.

### Proposed Fixes
1. **Add proper handling for xAI models via Vercel** - either add xAI as separate case or fix the endpoint routing:
```typescript
if (model.startsWith('vercel:')) {
  const parts = model.replace('vercel:', '').split('/');
  return openai(`xai:${parts[1]}`); // proper prefix for xAI
}
```

2. **Add xAI to OPENAI_COMPATIBLE_PROVIDERS** with correct baseURL

---

## Issue 11: LOG_FILE Context in log_output.md

The user saved full log to `log_output.md` - this is context for other issues.

---

## Summary Table

| Issue | Root Cause | File(s) to Fix |
|------|----------|---------------|
| #0 undefined.length | Missing `?.` null check | unified-agent-service.ts (lines 749, 844, 1105) |
| #0 circuitState | Session tracking | vercel-ai-streaming.ts |
| #3 database migration | Migration order | migrations/015_users_id_to_text.sql |
| #3b database locked | Restart conflict | connection.ts, migration-runner.ts |
| #2 tools not used | Tools not passed to API | unified-agent-service.ts: runV1ApiWithTools |
| #2 ROUTING_METADATA | Not parsed from response | Streaming response handling |
| #6 wrong path | Hardcoded session path | code-preview-panel.tsx:1597 |
| #7 vercel: prefix | Pre-stripped prefix in models | llm-providers.ts, vercel-ai-streaming.ts |
| #8 task classifier | Provider/model config | task-classifier.ts:356 |
| #10 vercel openai | Wrong endpoint mapping | vercel-ai-streaming.ts |

---

## Recommended Priority Fixes

### High Priority
1. Null checks for `userMessage?.length` (Issue #0)
2. Database migration order fix (Issue #3)
3. Tools passing debug in runV1ApiWithTools (Issue #2)
4. ROUTING_METADATA parsing (Issues #2, #3)

### Medium Priority
5. Circuit breaker session reset
6. xAI via Vercel endpoint fix
7. Owner ID fix in VFS

### Lower Priority
8. Vercel model prefix cleanup
9. Task classifier modernization

---

## Code References for Investigation

- **unified-agent-service.ts**: Main switch statement at line ~685-697 handles mode dispatch
- **vercel-ai-streaming.ts**: getVercelModel at line 292, OPENAI_COMPATIBLE_PROVIDERS at line 218
- **llm-providers.ts**: Vercel xAI models line 468-471
- **task-classifier.ts**: generateObject call line 361
- **connection.ts**: Schema initialization line 792, retry logic needed