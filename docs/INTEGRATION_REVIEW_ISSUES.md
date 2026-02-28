# Integration Review - Issues & Fixes

**Review Date:** 2026-02-27  
**Method:** SDK documentation comparison + edge case analysis

---

## 🔴 CRITICAL ISSUES FOUND

### 1. E2B Amp Service - Missing Sandbox.create Integration

**File:** `lib/sandbox/providers/e2b-amp-service.ts`

**Issue:** Current implementation requires passing sandbox instance, but docs show direct `Sandbox.create('amp')` pattern.

**Documentation Pattern:**
```typescript
import { Sandbox } from 'e2b'

const sandbox = await Sandbox.create('amp', {
  envs: { AMP_API_KEY: process.env.AMP_API_KEY },
})

const result = await sandbox.commands.run(
  `amp --dangerously-allow-all --stream-json -x "Task"`,
  { onStdout: handleEvent }
)
```

**Current Implementation Issue:**
```typescript
// Requires existing sandbox
export function createAmpService(sandbox: any, sandboxId: string): E2BAmpService
```

**Fix Required:** Add convenience function that creates sandbox internally.

---

### 2. Smithery Registry - Wrong Auth Header

**File:** `lib/mcp/smithery-registry.ts` line 109

**Issue:** Using `Authorization: Bearer` but docs show API key header.

**Documentation:**
```
Requires service token with connections:read scope
```

**Current Code:**
```typescript
headers['Authorization'] = `Bearer ${this.apiKey}`;
```

**Should Be:**
```typescript
// Smithery uses X-API-Key header
headers['X-API-Key'] = this.apiKey;
```

---

### 3. Composio Triggers - Wrong API Path

**File:** `lib/tools/composio-triggers.ts`

**Issue:** Using `/api/v1/triggers` but docs show different pattern.

**Documentation:**
```typescript
const composio = new Composio({ apiKey: '...' });
const result = await composio.triggers.list();
```

**Current Implementation:**
```typescript
// Direct REST API calls
fetch(`${this.baseUrl}/api/v1/triggers`)
```

**Should Use:** Composio SDK's triggers namespace if available, or verify API path.

---

### 4. Composio Triggers - Missing createTrigger Parameters

**Documentation:**
```typescript
async create(userId: string, slug: string, body?: {
  connectedAccountId?: string;
  triggerConfig?: Record<string, unknown>;
}): Promise<{ triggerId: string }>
```

**Current Implementation:**
```typescript
async createTrigger(config: ComposioTriggerConfig): Promise<ComposioTrigger>
```

**Missing:**
- `userId` parameter (required)
- `slug` parameter (required)
- `connectedAccountId` option
- Returns `{ triggerId: string }` not full trigger object

---

### 5. E2B Git Integration - Missing Error Handling

**File:** `lib/sandbox/providers/e2b-provider.ts` line 530

**Issue:** Git clone with auth credentials in URL is security risk.

**Current:**
```typescript
const urlWithAuth = url.replace('https://', `https://${username}:${password}@`);
```

**Security Issue:** Credentials visible in process lists, logs.

**Better Approach:** Use git credential helper or SSH keys.

---

### 6. MCP Client - Missing Error Types

**File:** `lib/mcp/client.ts`

**Issue:** No typed error classes for different failure modes.

**Missing:**
```typescript
class MCPError extends Error { ... }
class MCPConnectionError extends MCPError { ... }
class MCPTimeoutError extends MCPError { ... }
class MCPProtocolError extends MCPError { ... }
```

---

## 🟡 MEDIUM ISSUES

### 7. E2B Amp - Thread ID Parsing

**File:** `lib/sandbox/providers/e2b-amp-service.ts` line 240

**Issue:** Thread listing assumes JSON output format.

**Current:**
```typescript
const threads: AmpThread[] = JSON.parse(threadsResult.stdout);
```

**Risk:** If amp output format changes, this breaks.

**Fix:** Add try-catch and validate JSON structure.

---

### 8. Smithery - Missing Pagination

**File:** `lib/mcp/smithery-registry.ts`

**Issue:** Search doesn't handle pagination for large result sets.

**Documentation:**
```
Supports filtering with pagination
```

**Fix:** Add `nextPage()` method or async iterator.

---

### 9. Composio - Webhook Signature Verification

**File:** `lib/tools/composio-triggers.ts` line 280

**Issue:** Signature verification uses timing-safe compare but doesn't handle all edge cases.

**Current:**
```typescript
return crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expectedSignature)
);
```

**Missing:**
- Buffer length validation (timingSafeEqual throws if lengths differ)
- Hex encoding validation

---

### 10. MCP Client - Resource Subscription Not Tracked

**File:** `lib/mcp/client.ts`

**Issue:** No tracking of active subscriptions.

**Missing:**
```typescript
private subscribedResources = new Set<string>();

async subscribeResource(uri: string): Promise<void> {
  await this.request('resources/subscribe', { uri });
  this.subscribedResources.add(uri);
}
```

---

## 🟢 MINOR ISSUES

### 11. E2B Amp - Event Type Incomplete

**File:** `lib/sandbox/providers/e2b-amp-service.ts` line 75

**Documentation Events:**
- `assistant` ✅
- `result` ✅
- `tool_call` ❌ (missing)
- `thinking` ❌ (missing)
- `permission` ❌ (missing)
- `user` ❌ (missing)

---

### 12. Smithery - Missing Optional Fields

**File:** `lib/mcp/smithery-registry.ts` line 18

**Missing from SmitheryServer:**
```typescript
displayName?: string;
readme?: string;
githubUrl?: string;
toolCount?: number;
skillCount?: number;
```

---

### 13. Composio - Trigger Status Enum Incomplete

**File:** `lib/tools/composio-triggers.ts` line 18

**Current:**
```typescript
status: 'active' | 'inactive' | 'error';
```

**Documentation Shows:**
- `enabled` (not `active`)
- `disabled` (not `inactive`)

---

### 14. E2B Git - Depth Default

**File:** `lib/sandbox/providers/e2b-provider.ts` line 545

**Current:**
```typescript
const depth = options?.depth || 1;
```

**Issue:** Shallow clone (`depth: 1`) may break some git operations.

**Better Default:** `depth || 50` or full clone for production.

---

### 15. MCP Client - Progress Validation

**File:** `lib/mcp/client.ts` line 520

**Current:**
```typescript
async sendProgress(token: string, progress: number, total: number = 100)
```

**Missing Validation:**
```typescript
if (progress < 0 || progress > total) {
  throw new Error('Progress must be between 0 and total');
}
```

---

## RECOMMENDED FIXES PRIORITY

### Week 1 (Critical)
1. ✅ Fix Smithery auth header
2. ✅ Fix Composio triggers API to match SDK
3. ✅ Add proper error types to MCP client
4. ✅ Fix E2B Amp to support direct sandbox creation

### Week 2 (Medium)
5. Add subscription tracking to MCP client
6. Add pagination to Smithery search
7. Fix webhook signature verification
8. Add thread ID validation

### Week 3 (Minor)
9. Add missing event types
10. Add missing server fields
11. Fix trigger status enum
12. Add progress validation

---

## TESTS NEEDED

### E2B Amp Tests
```typescript
describe('E2B Amp Service', () => {
  it('should create sandbox with amp template', async () => {
    // Test sandbox creation
  });

  it('should stream JSON events', async () => {
    // Test event parsing
  });

  it('should handle thread continuation', async () => {
    // Test thread management
  });

  it('should capture git diff', async () => {
    // Test git integration
  });
});
```

### Smithery Tests
```typescript
describe('Smithery Client', () => {
  it('should search servers', async () => {
    // Test search
  });

  it('should create connection', async () => {
    // Test connection management
  });

  it('should download bundle', async () => {
    // Test bundle download
  });

  it('should handle pagination', async () => {
    // Test pagination
  });
});
```

### Composio Triggers Tests
```typescript
describe('Composio Triggers', () => {
  it('should create trigger', async () => {
    // Test trigger creation
  });

  it('should verify webhook signature', async () => {
    // Test signature verification
  });

  it('should subscribe to events', async () => {
    // Test event subscription
  });

  it('should retry failed execution', async () => {
    // Test retry logic
  });
});
```

### MCP Client Tests
```typescript
describe('MCP Client Enhanced', () => {
  it('should subscribe to resource', async () => {
    // Test subscription
  });

  it('should send progress', async () => {
    // Test progress
  });

  it('should cancel request', async () => {
    // Test cancellation
  });

  it('should handle log messages', async () => {
    // Test logging
  });
});
```

---

**Review Completed:** 2026-02-27  
**Critical Issues:** 6  
**Medium Issues:** 4  
**Minor Issues:** 5  
**Total Tests Needed:** 16+
