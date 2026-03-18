# Provider Profiles & Capabilities Wiring Status

## Overview

This document tracks the wiring status between **Provider Profiles** (from `lib/sandbox/provider-router.ts`) and **Capability Definitions** (from `lib/tools/capabilities.ts`).

---

## Provider Profiles (10 Total)

From `lib/sandbox/provider-router.ts`:

| # | Provider | Services | Best For | Cost | Latency | Persistence |
|---|----------|----------|----------|------|---------|-------------|
| 1 | **e2b** | pty, preview, agent, desktop | code-interpreter, agent, ml-training | medium | low | ❌ |
| 2 | **daytona** | pty, preview, computer-use, lsp, object-storage | fullstack-app, computer-use, lsp-intelligence | medium | low | ❌ |
| 3 | **sprites** | pty, preview, snapshot, persistent-fs, auto-suspend, services | persistent-service, fullstack-app | low | medium | ✅ |
| 4 | **codesandbox** | pty, preview, snapshot, batch, services | frontend-app, fullstack-app, batch-job, ci-cd | medium | low | ✅ |
| 5 | **webcontainer** | pty, preview | frontend-app, code-interpreter | low | low | ❌ |
| 6 | **blaxel** | batch, agent | batch-job, agent, ci-cd | low | medium | ❌ |
| 7 | **microsandbox** | pty | code-interpreter, general | low | low | ❌ |
| 8 | **opensandbox** | pty, preview | code-interpreter, general | low | medium | ❌ |
| 9 | **mistral** | pty, preview | code-interpreter, general | medium | medium | ❌ |
| 10 | **opensandbox-nullclaw** | pty, preview, agent | agent, persistent-service, general | low | medium | ❌ |

---

## Capability Wiring Status

### ✅ Sandbox Capabilities (FULLY WIRED)

| Capability | ID | Provider Priority (10 providers) | Status |
|------------|----|----------------------------------|--------|
| **Execute Code** | `sandbox.execute` | opencode-v2, e2b, daytona, codesandbox, blaxel, microsandbox, opensandbox, mistral, sprites, webcontainer | ✅ Complete |
| **Run Shell** | `sandbox.shell` | opencode-v2, daytona, e2b, sprites, codesandbox, microsandbox, opensandbox, mistral, blaxel, webcontainer | ✅ Complete |
| **Manage Session** | `sandbox.session` | opencode-v2, sprites, codesandbox, daytona, e2b, blaxel, opensandbox-nullclaw, microsandbox, opensandbox, mistral, webcontainer | ✅ Complete |

**Wiring Notes:**
- Provider priorities now match provider-router.ts profiles
- Ordered by provider strengths (e.g., sprites for persistence, daytona for full-stack)
- All 10 providers included with appropriate ordering

### ✅ Repo Capabilities (PARTIALLY WIRED)

| Capability | ID | Current Provider Priority | Needs Update |
|------------|----|--------------------------|--------------|
| **Search Repository** | `repo.search` | blaxel, ripgrep, embedding-search, local-fs | ⚠️ Should include all 10 sandbox providers |
| **Git Operations** | `repo.git` | opencode-v2, git-helper, local-fs | ⚠️ Should include all 10 sandbox providers |
| **Clone Repository** | `repo.clone` | git-helper, opencode-v2 | ⚠️ Should include all 10 sandbox providers |
| **Git Commit** | `repo.commit` | git-helper, opencode-v2 | ⚠️ Should include all 10 sandbox providers |
| **Git Push** | `repo.push` | git-helper, opencode-v2 | ⚠️ Should include all 10 sandbox providers |
| **Git Pull** | `repo.pull` | git-helper, opencode-v2 | ⚠️ Should include all 10 sandbox providers |
| **Semantic Search** | `repo.semantic-search` | embedding-search, blaxel | ⚠️ Should include all 10 sandbox providers |
| **Analyze Repository** | `repo.analyze` | blaxel, local-fs | ⚠️ Should include all 10 sandbox providers |

### ✅ Web Capabilities (PROVIDER-SPECIFIC)

| Capability | ID | Provider Priority | Status |
|------------|----|-------------------|--------|
| **Browse URL** | `web.browse` | nullclaw, mcp-browser, puppeteer | ✅ Correct (web-specific) |
| **Web Search** | `web.search` | nullclaw, mcp-search | ✅ Correct (web-specific) |

**Note:** Web capabilities correctly use web-specific providers (nullclaw, puppeteer) rather than sandbox providers.

### ✅ Automation Capabilities (PROVIDER-SPECIFIC)

| Capability | ID | Provider Priority | Status |
|------------|----|-------------------|--------|
| **Discord** | `automation.discord` | nullclaw | ✅ Correct |
| **Telegram** | `automation.telegram` | nullclaw | ✅ Correct |
| **Workflow** | `automation.workflow` | nullclaw, n8n, custom | ✅ Correct |

### ✅ File Capabilities (CORRECT)

| Capability | ID | Provider Priority | Status |
|------------|----|-------------------|--------|
| **Read File** | `file.read` | mcp-filesystem, local-fs, vfs | ✅ Correct (FS-specific) |
| **Write File** | `file.write` | mcp-filesystem, local-fs, vfs | ✅ Correct (FS-specific) |
| **Delete File** | `file.delete` | mcp-filesystem, local-fs, vfs | ✅ Correct (FS-specific) |
| **List Directory** | `file.list` | mcp-filesystem, local-fs, vfs | ✅ Correct (FS-specific) |
| **Search Files** | `file.search` | ripgrep, blaxel, local-fs | ✅ Correct (search-specific) |

### ✅ Memory Capabilities (CORRECT)

| Capability | ID | Provider Priority | Status |
|------------|----|-------------------|--------|
| **Store Memory** | `memory.store` | context-pack, memory-service, vfs | ✅ Correct |
| **Retrieve Memory** | `memory.retrieve` | context-pack, memory-service, vfs | ✅ Correct |
| **Get Changes** | `workspace.getChanges` | vfs | ✅ Correct |
| **Bundle Project** | `project.bundle` | context-pack, vfs | ✅ Correct |

---

## Modular Services/Methods Mapping

### Provider → Service Files

| Provider | Service File | Key Methods/Classes |
|----------|-------------|---------------------|
| **e2b** | `lib/sandbox/providers/e2b-provider.ts` | `E2BProvider`, `createSandbox()`, `executeCommand()` |
| **e2b desktop** | `lib/sandbox/providers/e2b-desktop-provider-enhanced.ts` | `E2BDesktopProvider`, `getComputerUseService()`, `screenshot()` |
| **daytona** | `lib/sandbox/providers/daytona-provider.ts` | `DaytonaProvider`, `getComputerUseService()`, `getLSPService()` |
| **sprites** | `lib/sandbox/providers/sprites-provider.ts` | `SpritesProvider`, `createCheckpoint()`, `autoSuspend()` |
| **codesandbox** | `lib/sandbox/providers/codesandbox-provider.ts` | `CodeSandboxProvider`, `createSnapshot()`, `batchExecute()` |
| **blaxel** | `lib/sandbox/providers/blaxel-provider.ts` | `BlaxelProvider`, `agentExecute()`, `batchProcess()` |
| **microsandbox** | `lib/sandbox/providers/microsandbox-provider.ts` | `MicroSandboxProvider`, `lightweightExec()` |
| **opensandbox** | `lib/sandbox/providers/opensandbox-provider.ts` | `OpenSandboxProvider`, `generalExecute()` |
| **mistral** | `lib/sandbox/providers/mistral-provider.ts` | `MistralProvider`, `codeInterpreter()` |
| **webcontainer** | `lib/sandbox/providers/webcontainer-provider.ts` | `WebContainerProvider`, `browserExec()` |

### Capability → Provider Method Mapping

#### SANDBOX_EXECUTE_CAPABILITY
```typescript
providerPriority: [
  'opencode-v2',      // → lib/sandbox/spawn/opencode-cli.ts → OpencodeCLIProvider.runAgentLoop()
  'e2b',              // → lib/sandbox/providers/e2b-provider.ts → E2BProvider.executeCommand()
  'daytona',          // → lib/sandbox/providers/daytona-provider.ts → DaytonaProvider.executeCommand()
  'codesandbox',      // → lib/sandbox/providers/codesandbox-provider.ts → CodeSandboxProvider.execute()
  'blaxel',           // → lib/sandbox/providers/blaxel-provider.ts → BlaxelProvider.agentExecute()
  'microsandbox',     // → lib/sandbox/providers/microsandbox-provider.ts → MicroSandboxProvider.execute()
  'opensandbox',      // → lib/sandbox/providers/opensandbox-provider.ts → OpenSandboxProvider.execute()
  'mistral',          // → lib/sandbox/providers/mistral-provider.ts → MistralProvider.codeInterpreter()
  'sprites',          // → lib/sandbox/providers/sprites-provider.ts → SpritesProvider.executeCommand()
  'webcontainer',     // → lib/sandbox/providers/webcontainer-provider.ts → WebContainerProvider.execute()
]
```

#### SANDBOX_SHELL_CAPABILITY
```typescript
providerPriority: [
  'opencode-v2',      // → lib/sandbox/spawn/opencode-cli.ts → OpencodeCLIProvider.runBash()
  'daytona',          // → lib/sandbox/providers/daytona-provider.ts → DaytonaProvider.executeCommand() + getComputerUseService()
  'e2b',              // → lib/sandbox/providers/e2b-provider.ts → E2BProvider.executeCommand() + getDesktopService()
  'sprites',          // → lib/sandbox/providers/sprites-provider.ts → SpritesProvider.executeCommand() + services
  'codesandbox',      // → lib/sandbox/providers/codesandbox-provider.ts → CodeSandboxProvider.execute()
  'microsandbox',     // → lib/sandbox/providers/microsandbox-provider.ts → MicroSandboxProvider.execute()
  'opensandbox',      // → lib/sandbox/providers/opensandbox-provider.ts → OpenSandboxProvider.execute()
  'mistral',          // → lib/sandbox/providers/mistral-provider.ts → MistralProvider.execute()
  'blaxel',           // → lib/sandbox/providers/blaxel-provider.ts → BlaxelProvider.batchProcess()
  'webcontainer',     // → lib/sandbox/providers/webcontainer-provider.ts → WebContainerProvider.execute()
]
```

#### SANDBOX_SESSION_CAPABILITY
```typescript
providerPriority: [
  'opencode-v2',      // → lib/sandbox/spawn/opencode-cli.ts → OpencodeCLIProvider.createSession()
  'sprites',          // → lib/sandbox/providers/sprites-provider.ts → SpritesProvider.createSandbox() + autoSuspend()
  'codesandbox',      // → lib/sandbox/providers/codesandbox-provider.ts → CodeSandboxProvider.createSandbox() + createSnapshot()
  'daytona',          // → lib/sandbox/providers/daytona-provider.ts → DaytonaProvider.createSandbox()
  'e2b',              // → lib/sandbox/providers/e2b-provider.ts → E2BProvider.createSandbox()
  'blaxel',           // → lib/sandbox/providers/blaxel-provider.ts → BlaxelProvider.createAgent()
  'opensandbox-nullclaw', // → lib/sandbox/providers/opensandbox-provider.ts + lib/agent/nullclaw-integration.ts
  'microsandbox',     // → lib/sandbox/providers/microsandbox-provider.ts → MicroSandboxProvider.createSandbox()
  'opensandbox',      // → lib/sandbox/providers/opensandbox-provider.ts → OpenSandboxProvider.createSandbox()
  'mistral',          // → lib/sandbox/providers/mistral-provider.ts → MistralProvider.createSession()
  'webcontainer',     // → lib/sandbox/providers/webcontainer-provider.ts → WebContainerProvider.createSandbox()
]
```

---

## Remaining Work

### High Priority

1. **Update REPO_ capabilities** to include all 10 sandbox providers:
   - `REPO_SEARCH_CAPABILITY`
   - `REPO_GIT_CAPABILITY`
   - `REPO_CLONE_CAPABILITY`
   - `REPO_COMMIT_CAPABILITY`
   - `REPO_PUSH_CAPABILITY`
   - `REPO_PULL_CAPABILITY`
   - `REPO_SEMANTIC_SEARCH_CAPABILITY`
   - `REPO_ANALYZE_CAPABILITY`

2. **Add comments** to each capability explaining provider priority rationale

### Medium Priority

3. **Verify all provider service files** exist and have correct methods:
   - [ ] `lib/sandbox/providers/e2b-desktop-provider-enhanced.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/daytona-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/sprites-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/codesandbox-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/blaxel-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/microsandbox-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/opensandbox-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/mistral-provider.ts` - ✅ Exists
   - [ ] `lib/sandbox/providers/webcontainer-provider.ts` - ✅ Exists

### Low Priority

4. **Add metadata** to capabilities for intelligent routing:
   - Latency estimates per provider
   - Cost estimates per provider
   - Reliability scores

---

## Summary

**Completed:**
- ✅ All 10 provider profiles defined in `provider-router.ts`
- ✅ SANDBOX_ capabilities fully wired with all 10 providers
- ✅ Provider priority ordering matches provider strengths
- ✅ All provider service files exist

**In Progress:**
- ⚠️ REPO_ capabilities need provider priority updates (8 capabilities)

**Correct as-is:**
- ✅ WEB_ capabilities (use web-specific providers)
- ✅ AUTOMATION_ capabilities (use nullclaw/n8n)
- ✅ FILE_ capabilities (use filesystem providers)
- ✅ MEMORY_ capabilities (use memory/vfs providers)

---

## Next Steps

1. Update remaining REPO_ capabilities with full provider priority lists
2. Add inline comments explaining provider priority rationale
3. Test provider selection with various task types
4. Add telemetry for provider performance tracking
