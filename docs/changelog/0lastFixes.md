# Integration Review & Fix Plan: binG0 + Tools + Sandbox

**Reviewed**: 2026-02-16  
**Scope**: All files created/modified for tools/ and sandbox (dayTona) integration into binG0/

---

## Summary

The implementation follows the `sandboxPLAN.md` architecture reasonably well. The priority router, OAuth service, tool authorization manager, webhook handler, and API routes are structurally sound. However, there are **15 errors and issues** ranging from build-breaking import failures to logic bugs and security gaps that must be fixed before this can work.

---

## 🔴 Critical Errors (Will Break Build / Runtime)

### 1. `detectRequestType` used but never imported in `priority-request-router.ts`

**File**: `lib/api/priority-request-router.ts` lines 76, 95  
**Problem**: `detectRequestType(req.messages)` is called in the `canHandle` lambdas of the `tool-execution` and `sandbox-agent` endpoints, but the function is never imported. The file imports from `../tools`, `../services/tool-authorization-manager`, `../services/tool-context-manager`, `../sandbox`, and `./llm-providers` — but not `detectRequestType` from anywhere.

**Fix**:
```typescript
// Add to imports at top of priority-request-router.ts
import { detectRequestType } from '../utils/request-type-detector';
```

---

### 2. `SandboxService` exported from `index.ts` but class is named `SandboxServiceBridge`

**File**: `lib/sandbox/index.ts` line 3  
**Problem**: `export { SandboxService } from './sandbox-service-bridge'` — but the class exported from `sandbox-service-bridge.ts` is `SandboxServiceBridge`, not `SandboxService`. This is a named export mismatch.

**Fix**:
```typescript
// lib/sandbox/index.ts line 3
export { SandboxServiceBridge as SandboxService } from './sandbox-service-bridge';
```

---

### 3. `sandboxBridge` not exported from `lib/sandbox/index.ts` but imported via `'../sandbox'`

**File**: `lib/api/priority-request-router.ts` line 13  
**Problem**: `import { sandboxBridge } from '../sandbox'` resolves to `lib/sandbox/index.ts`, which only exports `SandboxService` and types — not `sandboxBridge`. The singleton `sandboxBridge` is exported from `sandbox-service-bridge.ts` directly.

**Fix**: Add to `lib/sandbox/index.ts`:
```typescript
export { sandboxBridge } from './sandbox-service-bridge';
```

---

### 4. `lib/sandbox/index.ts` imports types from nonexistent `../../lib/types`

**File**: `lib/sandbox/index.ts` line 4  
**Problem**: `export type { WorkspaceSession, ToolResult, SandboxConfig, PreviewInfo } from '../../lib/types'` — from `binG0/lib/sandbox/index.ts`, `../../lib/types` resolves to `dayTona/lib/types.ts` (the parent sandbox module). This path is outside the Next.js project root and will fail at build time. Additionally, `binG0/lib/types.ts` does not exist.

**Fix**: Either:
- (a) Copy `dayTona/lib/types.ts` into `binG0/lib/sandbox/types.ts` and re-export from there, OR
- (b) Remove the line since `sandbox-service-bridge.ts` already defines `WorkspaceSession` and `SandboxConfig` locally, and `ToolResult`/`PreviewInfo` aren't used anywhere in binG0.

```typescript
// lib/sandbox/index.ts — simplified
export { SandboxServiceBridge as SandboxService, sandboxBridge } from './sandbox-service-bridge';
export type { WorkspaceSession, SandboxConfig } from './sandbox-service-bridge';
```

---

### 5. `sandbox-service-bridge.ts` imports from nonexistent `'../types'`

**File**: `lib/sandbox/sandbox-service-bridge.ts` line 7  
**Problem**: `import type { ToolResult, PreviewInfo } from '../types'` — `binG0/lib/types.ts` does not exist. This import will fail.

**Fix**: Remove the import — `ToolResult` and `PreviewInfo` are never used in the file (all methods use `any` returns from the proxied sandbox service).
```typescript
// Remove line 7:
// import type { ToolResult, PreviewInfo } from '../types';
```

---

### 6. `sandbox-service-bridge.ts` dynamic import path is wrong

**File**: `lib/sandbox/sandbox-service-bridge.ts` line 38  
**Problem**: `await import('../../lib/sandbox-service')` — from `binG0/lib/sandbox/sandbox-service-bridge.ts`, this resolves to `dayTona/lib/sandbox-service.ts`. This is outside the Next.js build tree and will fail in production builds.

**Fix**: The sandbox module files need to be copied into `binG0/lib/sandbox/` as planned in `sandboxPLAN.md`, or the import should use a path alias. For now, since the bridge uses dynamic import with a try/catch, this is a graceful failure — but it means sandbox features will never work.

```typescript
// The correct approach: copy dayTona/lib/sandbox-service.ts into binG0/lib/sandbox/
// Then change to:
const mod = await import('./core/sandbox-service');
```

---

### 7. `sandbox/agent/route.ts` dynamic import path is wrong

**File**: `app/api/sandbox/agent/route.ts` line 22  
**Problem**: `await import('../../../../lib/agent-loop')` — from `binG0/app/api/sandbox/agent/route.ts`, this resolves to `binG0/lib/agent-loop.ts` which does not exist. The actual `agent-loop.ts` is at `dayTona/lib/agent-loop.ts`.

**Fix**: Copy `dayTona/lib/agent-loop.ts` into `binG0/lib/sandbox/agent-loop.ts` and update import:
```typescript
const mod = await import('@/lib/sandbox/agent-loop');
```

---

### 8. `lib/tools/index.ts` imports from outside project root

**File**: `lib/tools/index.ts` lines 3, 4, 6  
**Problem**: `from '../../tools/tool-integration-system'` — from `binG0/lib/tools/index.ts`, this resolves to `dayTona/tools/tool-integration-system.ts`, which is outside the Next.js project. This may work in dev mode but will fail in production builds.

**Fix**: Copy `dayTona/tools/tool-integration-system.ts` into `binG0/lib/tools/tool-integration-system.ts` and update imports to:
```typescript
export { ToolIntegrationManager, TOOL_REGISTRY, parseIntentToTool, formatToolOutput } from './tool-integration-system';
```

---

### 9. `tool-context-manager.ts` imports wrong export name

**File**: `lib/services/tool-context-manager.ts` line 2  
**Problem**: `import { toolAuthorizationManager } from '@/lib/services/tool-authorization-manager'` — but the exported singleton in `tool-authorization-manager.ts` is named `toolAuthManager`, not `toolAuthorizationManager`.

**Fix**:
```typescript
import { toolAuthManager as toolAuthorizationManager } from '@/lib/services/tool-authorization-manager';
// OR rename the export in tool-authorization-manager.ts
```

---

## 🟡 Logic & Integration Bugs

### 10. Duplicate intent detection — three separate implementations

**Files**: 
- `lib/utils/request-type-detector.ts` (`detectRequestType`)
- `lib/api/intent-detector.ts` (`detectIntent`)
- `lib/services/tool-context-manager.ts` (`detectToolIntent` — private method)

**Problem**: Three separate regex-based intent detection systems with overlapping but inconsistent pattern sets. The chat route uses `detectRequestType`, the router uses `detectRequestType` (but doesn't import it), and `intent-detector.ts` exists but is never imported anywhere. Tool context manager does its own detection inline.

**Fix**: Consolidate to one. Remove `intent-detector.ts` (unused). Make `request-type-detector.ts` the canonical implementation. Have `tool-context-manager.ts` use it instead of its own inline detection:
```typescript
import { detectRequestType } from '@/lib/utils/request-type-detector';
```

---

### 11. Tool execute route bypasses authorization for unknown providers

**File**: `app/api/tools/execute/route.ts` lines 14-28  
**Problem**: When `toolAuthManager.isAuthorized()` returns `false`, it only returns `auth_required` if `getRequiredProvider()` returns a non-null value. If the provider is null (unknown tool), it falls through and executes the tool without auth.

**Fix**: Add explicit deny for unauthorized, unknown tools:
```typescript
const authorized = await toolAuthManager.isAuthorized(userId, toolKey);
if (!authorized) {
  const provider = toolAuthManager.getRequiredProvider(toolKey);
  const authUrl = provider ? toolAuthManager.getAuthorizationUrl(provider) : null;
  return NextResponse.json({
    status: 'auth_required',
    authUrl,
    provider: provider || 'unknown',
    toolName: toolKey,
    message: provider
      ? `Please connect your ${provider} account to use ${toolKey}`
      : `Authorization required for ${toolKey}`,
  }, { status: 403 });
}
```

---

### 12. `AUTH_REQUIRED:` string parsing in chat route is fragile

**File**: `app/api/chat/route.ts` lines 149-158 and 216-226  
**Problem**: Auth detection via `response.content?.includes('AUTH_REQUIRED:')` and splitting on `:` is brittle — URLs contain `:` (e.g. `https://...`), so `split(':')[1]` will return `https` instead of the full URL. Also this check appears twice (duplicated code).

**Fix**: Use a structured response instead of string parsing. The router's `processToolRequest` already returns `{ data: { requiresAuth: true, authUrl, toolName } }` — this is correctly handled at line 135-143. Remove the string-based `AUTH_REQUIRED:` checks at lines 149-158 and 216-226 entirely, as they're redundant with the structured check above and will produce wrong results.

---

### 13. Sandbox route directly executes user message as shell command

**File**: `lib/api/priority-request-router.ts` line 526  
**Problem**: `sandboxBridge.executeCommand(session.sandboxId, lastUserMessage)` — this takes the raw user chat message (e.g. "build a Python REST API") and passes it directly as a shell command. Natural language is not a shell command; this will always fail with `command not found`.

**Fix**: The sandbox should use the agent loop (like `app/api/sandbox/agent/route.ts` does), not raw command execution. Replace `processSandboxRequest` to use the agent loop:
```typescript
private async processSandboxRequest(request: RouterRequest): Promise<any> {
  // ... auth checks ...
  const session = await sandboxBridge.getOrCreateSession(request.userId!);
  
  // Use the agent loop, NOT direct command execution
  try {
    const { runAgentLoop } = await import('../sandbox/agent-loop');
    const result = await runAgentLoop({
      userMessage: lastUserMessage,
      sandboxId: session.sandboxId,
      conversationHistory: request.messages,
    });
    return {
      content: result.response,
      data: { source: 'sandbox-agent', steps: result.steps }
    };
  } catch {
    // Fallback: pass to regular LLM with sandbox context
    return { content: 'Sandbox module not available.', data: { source: 'sandbox-agent', error: 'not_configured' } };
  }
}
```

---

## 🟠 Security Issues

### 14. Webhook routes lack signature verification

**File**: `app/api/webhooks/route.ts`  
**Problem**: Both Arcade and Nango webhook handlers accept any POST body without verifying webhook signatures. An attacker could forge webhook calls to create fake OAuth connections for any user.

**Fix**: Add signature verification:
```typescript
// For Arcade:
const signature = req.headers.get('x-arcade-signature');
if (!signature || !verifyArcadeSignature(body, signature)) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
}

// For Nango:
const nangoSig = req.headers.get('x-nango-signature');
if (!nangoSig || !verifyNangoSignature(body, nangoSig)) {
  return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
}
```

---

### 15. Sandbox execute route has no user ownership verification

**File**: `app/api/sandbox/execute/route.ts`  
**Problem**: The route accepts `userId`, `command`, and `sandboxId` from the request body but never verifies that the requesting user owns the specified sandboxId. Any authenticated user could execute commands on another user's sandbox.

**Fix**: Verify sandbox ownership:
```typescript
const session = sandboxBridge.getSession(sandboxId);
if (!session || session.userId !== userId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
}
```

---

## 🔵 Minor Issues & Improvements

### 16. `connection.ts` uses deprecated `crypto.createCipher`

**File**: `lib/database/connection.ts` lines 135, 153  
**Problem**: `crypto.createCipher` and `crypto.createDecipher` are deprecated in Node.js. The oauth-service.ts correctly uses `createCipheriv` — but the original connection.ts still uses the deprecated API.

**Note**: Not introduced by this PR, but worth fixing alongside since the OAuth service already has the correct pattern.

---

### 17. `toolAuthManager` vs `toolAuthorizationManager` naming inconsistency

**Files**: `lib/services/tool-authorization-manager.ts` exports `toolAuthManager`, but `tool-context-manager.ts` imports `toolAuthorizationManager` (see Issue #9).

**Fix**: Pick one name. Recommend `toolAuthManager` since it's shorter and already used in the API routes.

---

### 18. `useToolIntegration` hook has stale closure issue

**File**: `hooks/use-tool-integration.ts` line 83  
**Problem**: `executeTool` callback depends on `[options]`, but `options` is an object that may get a new reference every render, causing unnecessary re-renders. The `onAuthRequired`, `onSuccess`, `onError` callbacks inside will capture stale refs.

**Fix**: Use `useRef` for the options callbacks or destructure the stable primitives:
```typescript
const optionsRef = useRef(options);
optionsRef.current = options;

const executeTool = useCallback(async (toolKey: string, input: any) => {
  const opts = optionsRef.current;
  // ...use opts instead of options
}, []);
```

---

## Implementation Priority Order

1. **Fix #1, #3, #4, #5** — Import/export mismatches (sandbox module won't resolve)
2. **Fix #8** — Copy tool-integration-system.ts into binG0 (tools won't resolve)
3. **Fix #9** — Named export mismatch (tool context manager crashes)
4. **Fix #7, #6** — Copy/fix sandbox module paths (sandbox features non-functional)
5. **Fix #13** — Sandbox processes raw text as command (logical error)
6. **Fix #12** — Remove fragile AUTH_REQUIRED string parsing
7. **Fix #10** — Consolidate intent detection
8. **Fix #14, #15** — Security fixes
9. **Fix #11** — Auth bypass for unknown tools
10. **Fix #16, #17, #18** — Minor cleanup

---

## Files That Need Copying Into binG0

Per the plan, these dayTona files should be copied into `binG0/lib/sandbox/`:

| Source (dayTona/) | Destination (binG0/) |
|---|---|
| `lib/types.ts` | `lib/sandbox/types.ts` |
| `lib/sandbox-service.ts` | `lib/sandbox/core/sandbox-service.ts` |
| `lib/agent-loop.ts` | `lib/sandbox/agent-loop.ts` |
| `lib/tools.ts` | `lib/sandbox/sandbox-tools.ts` |
| `lib/session-store.ts` | `lib/sandbox/session-store.ts` |
| `lib/dep-cache.ts` | `lib/sandbox/dep-cache.ts` |
| `lib/daemon-manager.ts` | `lib/sandbox/daemon-manager.ts` |
| `lib/terminal-manager.ts` | `lib/sandbox/terminal-manager.ts` |
| `lib/providers/` | `lib/sandbox/providers/` |
| `tools/tool-integration-system.ts` | `lib/tools/tool-integration-system.ts` |
| `tools/tool-utilities.ts` | `lib/tools/tool-utilities.ts` |

All imports in these files need path adjustment after copying.
