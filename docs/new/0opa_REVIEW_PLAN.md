# CodeSandbox SDK Integration Review - Technical Implementation Plan

## Executive Summary

This document outlines findings from a comprehensive review of the codebase, focusing on sandbox providers, tool calling integrations, and advanced features. The review compared implementation against SDK documentation to identify gaps, missing features, and areas for improvement.

**STATUS: Phase 1 Completed - Critical fixes implemented**

---

## Part 1: CodeSandbox Provider Implementation Review

### Current State Analysis

**File:** `lib/sandbox/providers/codesandbox-provider.ts`

#### ✅ Implemented Features (from documentation review):
1. Basic sandbox creation via SDK
2. Resume/get existing sandboxes  
3. Shutdown/destroy sandboxes
4. File operations: writeFile, readFile, listDirectory
5. Command execution
6. PTY terminal support
7. Preview link generation
8. Quota management integration
9. Provider registry integration

#### 🔴 Critical Issues Fixed:
1. **Wrong workspace directory** - Changed from `/project/sandbox` to `/project/workspace` (per docs)
2. **Binary file operations** - Added writeFileBinary, readFileBinary
3. **Batch write** - Added for efficient multi-file operations
4. **File manipulation** - Added copyFile, renameFile, removeFile

#### 🟡 Advanced Features Added (codesandbox-advanced.ts):
- Execution Recorder for deterministic replay
- Snapshot Manager with diff computation
- Idle Manager for auto-suspend
- Resource Scaler for dynamic scaling
- Port Manager for exposed port tracking
- Pre-commit Validator for change validation

---

## Part 2: E2B Provider Gap Analysis

**Reference:** `docs/sdk/e2b-llms-full.txt`

### Status: Git Integration Added ✅

**File:** `lib/sandbox/providers/e2b-provider.ts`

#### Added Features:
| Feature | Implementation | Status |
|---------|--------------|--------|
| Git clone | `E2BGitIntegration.clone()` | ✅ Added |
| Git command | `E2BGitIntegration.run()` | ✅ Added |
| MCP URL access | Available via `sandbox.getMcpUrl()` | ✅ Available |

#### TypeScript Errors Fixed:
- Added local type definitions for `FilesystemEvent`, `WatchHandle`, `CommandHandle`
- Fixed callback parameter typing in watchDirectory

---

## Part 3: Blaxel Provider Gap Analysis

**Reference:** `docs/sdk/blaxel-llms-full.txt`

### Missing Features:

| Feature | Documentation | Implementation | Status |
|---------|--------------|-----------------|--------|
| Async triggers with callbacks | ✅ Full webhook support | ⚠️ Partial | MEDIUM |
| Callback signature verification | ✅ `verifyWebhookFromRequest` | ❌ Not implemented | HIGH |
| Agent deployment | ✅ Serverless endpoints | ❌ Not implemented | LOW |
| Trigger configuration | ✅ Via blaxel.toml | ❌ Not implemented | LOW |

### Pre-existing Issues (not blocking):
- `@blaxel/sdk` module not found (package not installed)
- `@blaxel/core` module not found (package not installed)

**Reference:** `docs/sdk/mistral-llms-full.txt`

### API Endpoints Not Used:
- File upload/download (`/v1/files`)
- Fine-tuning jobs (`/v1/fine_tuning/*`)
- Batch jobs (`/v1/batch/*`)
- OCR (`/v1/ocr`)
- Moderations (`/v1/moderations`)
- Libraries/Documents (`/v1/libraries/*`)

---

## Part 5: Composio Integration Review

**Reference:** `docs/sdk/composio-llms-full.txt`

### Current Implementation:
- Basic tool execution via `ComposioToolSet`
- Session management

### Missing Patterns:
```typescript
// INCORRECT pattern seen in some code:
const toolset = new ComposioToolSet({ apiKey })

// CORRECT pattern (per docs):
const composio = new Composio()
const session = composio.create(userId)
const tools = session.tools()  // NOT toolset.tools()
```

### Missing:
- Proper session-based integration
- MCP URL/header access for cursor/claude desktop
- Auth config management
- Connected account management

---

## Part 6: Tool Router Analysis

**File:** `lib/tool-integration/router.ts`

### Current Chain:
```typescript
const DEFAULT_ROUTER_CONFIG = {
  providerChain: ['arcade', 'nango', 'composio', 'mcp', 'tambo'],
}
```

### Issues Found:
1. **Missing fallback for Smithery** - Should add `smithery` to chain
2. **No rate limiting between providers** - Could cause cascading failures
3. **Retry logic limited** - Only pattern-based, no exponential backoff

---

## Part 7: Security & Edge Cases

### Command Blocking (sandbox-tools.ts):

Current patterns are good but missing:
```typescript
// ADDITIONAL BLOCKED PATTERNS to add:
const ADDITIONAL_BLOCKED = [
  /:(){ :|:& };:/,  // Fork bomb variations
  /chsh\s+/,         // Change shell
  /pwgen\s+/,        // Password generation (could be used for mining)
  /shutdown\s+/,     // System shutdown
  /reboot\s+/,      // System reboot
  /init\s+\d/,      // Runlevel change
  /mount\s+--bind/, // Bind mount (escape chroot)
]
```

### Input Validation Improvements Needed:
1. File path traversal prevention (already implemented)
2. Command injection prevention (improved)
3. Path normalization for write operations
4. Maximum file size limits
5. Rate limiting per user/session

---

## Part 8: Recommended Implementation Plan

### Phase 1: Critical Fixes (Immediate)

#### 1.1 Fix E2B Git Integration
```typescript
// lib/sandbox/providers/e2b-provider.ts additions
class E2BSandboxHandle {
  async gitClone(url: string, options?: {
    path?: string;
    username?: string;
    password?: string;
    depth?: number;
  }): Promise<ToolResult> {
    try {
      const args = ['clone']
      if (options?.depth) args.push(`--depth ${options.depth}`)
      if (options?.username && options?.password) {
        args.push(`https://${options.username}:${options.password}@${url.replace(/https:\/\//, '')}`)
      } else {
        args.push(url)
      }
      if (options?.path) args.push(options.path)
      
      const result = await this.sandbox.git.run(args.join(' '))
      return { success: result.exitCode === 0, output: result.stdout }
    } catch (error) {
      return { success: false, output: error.message }
    }
  }

  async getMcpUrl(): Promise<string | null> {
    try {
      return this.sandbox.getMcpUrl() || null
    } catch {
      return null
    }
  }
}
```

#### 1.2 Fix Blaxel Callback Verification
```typescript
// lib/sandbox/providers/blaxel-callback-verify.ts
import { createHmac } from 'crypto'

export function verifyBlaxelCallback(
  payload: string,
  signature: string,
  timestamp: string,
  secret: string
): boolean {
  const signedPayload = `${timestamp}.${payload}`
  const expectedSignature = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex')
  
  return signature === expectedSignature
}
```

### Phase 2: High Priority (This Sprint)

#### 2.1 Unified Execution Recording
Make codesandbox-advanced patterns available across all providers:
```typescript
// lib/sandbox/providers/unified-execution-recorder.ts
export interface ExecutionRecorder {
  record(event: ExecutionEvent): void
  getEvents(): ExecutionEvent[]
  export(): string
  replay(handle: SandboxHandle): Promise<void>
}
```

#### 2.2 Tool Router Improvements
```typescript
// Add exponential backoff to router.ts
async executeWithRetry(
  provider: ToolProvider,
  request: ProviderExecutionRequest,
  maxRetries = 3
): Promise<ToolExecutionResult> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await provider.execute(request)
    if (result.success) return result
    
    const delay = Math.pow(2, attempt) * 1000  // 1s, 2s, 4s
    await new Promise(r => setTimeout(r, delay))
  }
  return result
}
```

### Phase 3: Medium Priority (Next Sprint)

#### 3.1 Template Building Support
For E2B and CodeSandbox, add template building:
```typescript
// lib/sandbox/providers/template-builder.ts
export class SandboxTemplateBuilder {
  async buildE2BTemplate(
    name: string,
    baseTemplate: string,
    options: { cpuCount?: number; memoryMB?: number }
  ): Promise<string> {
    const template = Template()
      .fromTemplate(baseTemplate)
      // Add custom setup
    
    const result = await Template.build(template, name, {
      cpuCount: options.cpuCount || 2,
      memoryMB: options.memoryMB || 2048,
    })
    return result.id
  }
}
```

#### 3.2 MCP Gateway Integration
Add MCP support to providers:
```typescript
interface MCPConfig {
  serverUrl: string
  authToken?: string
}

async getMcpTools(config: MCPConfig): Promise<MCTTool[]> {
  const response = await fetch(`${config.serverUrl}/tools`, {
    headers: config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {}
  })
  return response.json()
}
```

### Phase 4: Low Priority (Backlog)

#### 4.1 Additional Provider Features:
- OpenCode template support
- Claude Code template integration
- Codex schema-validated output
- AMP agent support

#### 4.2 Advanced Tool Calling:
- Fine-tuned model routing based on task type
- Automatic tool selection based on success rates
- Cost optimization across providers

---

## Part 9: Environment Configuration Updates

### Recommended env.example Additions:

```bash
# E2B Git Integration
E2B_GIT_DEFAULT_DEPTH=1

# MCP Configuration  
MCP_GATEWAY_URL=https://mcp.example.com
MCP_GATEWAY_AUTH_TOKEN=

# Callback Verification
BLAXEL_CALLBACK_SECRET=

# Execution Recording
EXECUTION_RECORDING_ENABLED=true
EXECUTION_RECORDING_MAX_EVENTS=10000

# Template Building
E2B_TEMPLATE_BUILD_ENABLED=false
```

---

## Part 10: Testing Recommendations

### Unit Tests to Add:
1. E2B git clone with authentication
2. Blaxel callback signature verification
3. Tool router exponential backoff
4. Command blocking edge cases

### Integration Tests:
1. Full sandbox lifecycle with VFS sync
2. Tool execution across all providers
3. Fallback chain behavior

---

## Appendix: File Locations

| Component | File Path |
|-----------|-----------|
| CodeSandbox Provider | `lib/sandbox/providers/codesandbox-provider.ts` |
| CodeSandbox Advanced | `lib/sandbox/providers/codesandbox-advanced.ts` |
| E2B Provider | `lib/sandbox/providers/e2b-provider.ts` |
| E2B Git Integration | `lib/sandbox/providers/e2b-provider.ts` (exported) |
| Blaxel Provider | `lib/sandbox/providers/blaxel-provider.ts` |
| Tool Router | `lib/tool-integration/router.ts` |
| Sandbox Tools | `lib/sandbox/sandbox-tools.ts` |
| Agent Loop | `lib/sandbox/agent-loop.ts` |
| Technical Plan | `docs/new/IMPLEMENTATION_REVIEW_TECHNICAL_PLAN.md` |

---

## Part 11: Deep Issues Found (Phase 2 - Deeper Analysis)

### 11.1 Agent Loop Issues (`lib/sandbox/agent-loop.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 46 | Inline callback function signature doesn't match interface - `onToolExecution(toolName, args, toolResult)` defined inline but uses wrong parameter names for the outer `onToolExecution` callback | HIGH |
| 94 | Default case returns generic "Unknown tool" error - loses original toolName info | LOW |

**Fix needed:**
```typescript
// Line 46 - fix callback signature
onToolExecution(toolName: string, args: Record<string, any>, result: ToolResult) {
  // ... 
}
```

### 11.2 Core Sandbox Service Issues (`lib/sandbox/core-sandbox-service.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 88 | Memory leak: `sandboxProviderById.set(handle.id, provider)` - doesn't check if key already exists | MEDIUM |
| 120-129 | `allProviderTypes` has duplicates and inconsistent ordering with index.ts registry | MEDIUM |
| 14-16 | Primary provider is set from env but doesn't validate against registry availability | LOW |

### 11.3 Sandbox Service Bridge Issues (`lib/sandbox/sandbox-service-bridge.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 27 | `sandboxService: any = null` - loses type safety | MEDIUM |
| 29 | `process.env.SPRITES_TAR_PIPE_THRESHOLD` hardcoded in constructor - violates DI | LOW |
| 121-129 | `inferProviderFromSandboxId` - missing `codesandbox` detection | ~~HIGH~~ ✅ FIXED |

**Fix applied:**
```typescript
// Line 121-130 - add codesandbox detection
if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
```

### 11.4 Tool Router Issues (`lib/tool-integration/router.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 14 | `providerChain` - missing `smithery` | ~~MEDIUM~~ ✅ FIXED |
| 59-104 | **NO exponential backoff implemented** | ~~HIGH~~ ✅ FIXED |
| 76 | Single retry per provider - no actual retry logic | ~~HIGH~~ ✅ FIXED |

### 11.5 Blaxel Provider Critical Issues (`lib/sandbox/providers/blaxel-provider.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 580 | **CRITICAL**: `callbackSecrets` is declared inside method - gets recreated every call | ~~CRITICAL~~ ✅ FIXED |
| 614 | `verifyCallbackSignature` is async but `@blaxel/core` may not support async | HIGH |
| 377 | `createPty` throws error but some Blaxel versions may support it | LOW |

**Fix applied:**
```typescript
// Moved callbackSecrets to class-level static storage
private static callbackSecrets = new Map<string, string>()
```

### 11.6 Mistral Provider Issues (`lib/sandbox/providers/mistral-code-interpreter-provider.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 18 | In-memory session storage `mistralSessions` - not persistent across server restarts | MEDIUM |
| 91-103 | Conversation ID stored in memory - if lost, subsequent commands fail silently | HIGH |
| 128-150 | All filesystem operations return "not supported" - no way to prepare files before code execution | HIGH |

### 11.7 E2B Provider Issues (`lib/sandbox/providers/e2b-provider.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 56 | Hardcoded `WORKSPACE_DIR = '/home/user'` - but documentation uses `/workspace` | MEDIUM |
| 159 | Calls `quotaManager.findAlternative('sandbox', 'e2b')` - **Actually CORRECT** | N/A |

### 11.8 CodeSandbox Provider Issues (`lib/sandbox/providers/codesandbox-provider.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 37 | Hardcoded `WORKSPACE_DIR = '/project/workspace'` - should be configurable | LOW |
| 155-159 | `getSandbox` creates new SDK client each call - inefficient | MEDIUM |
| N/A | **Missing file watching** - no `watchDirectory` or `watchFile` implementation | HIGH |
| N/A | **Missing directory watching** - no watchDirectory callback support | HIGH |

### 11.9 Provider Registry Issues (`lib/sandbox/providers/index.ts`)

| Line | Issue | Severity |
|------|-------|----------|
| 45-96 | Priority ordering inconsistent: microsandbox=4, blaxel=5, sprites=6, codesandbox=7 - but mistral is 3 | MEDIUM |
| 74-83 | `mistral-agent` lazy factory uses `require()` instead of dynamic `import()` - potential ESM/CJS conflict | MEDIUM |

### 11.10 Tool Integration Parser Issues (`lib/tool-integration/parsers/`)

| File | Issue | Severity |
|------|-------|----------|
| dispatcher.ts:22 | `TOOL_CALLING_ALLOW_CONTENT_PARSING` defaults to false - grammar/xml parsing disabled by default | MEDIUM |
| native-parser.ts:22 | No validation of parsed arguments - malformed args could cause runtime errors | MEDIUM |

---

## Part 12: Critical Fixes Required (Immediate Action)

### ✅ FIX 1: Blaxel Callback Secret Storage (CRITICAL) - DONE

```typescript
// In BlaxelSandboxHandle class - moved to class level
private static callbackSecrets = new Map<string, string>()
```

### ✅ FIX 2: Add Exponential Backoff to Router (HIGH) - DONE

```typescript
// Added executeWithRetry method with exponential backoff
private async executeWithRetry(
  provider: ToolProvider,
  request: ProviderExecutionRequest,
  maxRetries: number = 3
): Promise<ToolExecutionResult> {
  let lastError: string = ''
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await provider.execute(request)
    if (result.success) return result
    
    lastError = result.error || 'Unknown error'
    
    if (!this.isRetryableError(lastError)) break
    
    const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
    await new Promise(r => setTimeout(r, delay))
  }
  
  return { success: false, error: lastError, provider: provider.name }
}
```

### ✅ FIX 3: Add Codesandbox to Bridge Provider Inference (HIGH) - DONE

```typescript
// Added codesandbox detection in sandbox-service-bridge.ts
if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
```

### ✅ FIX 4: Add Smithery to Router Chain (MEDIUM) - DONE

```typescript
// Added smithery to provider chain in router.ts
providerChain: ['arcade', 'nango', 'composio', 'mcp', 'smithery', 'tambo'],
```

---

## Appendix B: Files Requiring Changes

| File | Changes Needed | Status |
|------|---------------|--------|
| `lib/sandbox/agent-loop.ts` | Fix callback signature on line 46 | PENDING |
| `lib/sandbox/sandbox-service-bridge.ts` | Add codesandbox detection | ✅ DONE |
| `lib/tool-integration/router.ts` | Add exponential backoff, smithery to chain | ✅ DONE |
| `lib/sandbox/providers/blaxel-provider.ts` | Fix callback secret storage | ✅ DONE |
| `lib/sandbox/providers/mistral-code-interpreter-provider.ts` | Add filesystem support or document limitation | PENDING |
| `lib/sandbox/providers/codesandbox-provider.ts` | Add file watching support | PENDING |

---

*Generated: February 2026*
*Review Status: Phase 2 Complete - Critical fixes implemented*
*Next Steps: Fix remaining agent-loop, mistral, and codesandbox issues*
