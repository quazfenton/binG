---
id: modal-sandbox-provider-last-resort-fallback
title: Modal Sandbox Provider - Last Resort Fallback
aliases:
  - modal-sandbox-provider
  - modal-sandbox-provider.md
tags: []
layer: core
summary: "# Modal Sandbox Provider - Last Resort Fallback\r\n\r\n## Overview\r\n\r\nThe **Modal Sandbox Provider** is the absolute last fallback in the binG sandbox provider chain. When all other sandbox providers (Daytona, E2B, Sprites, CodeSandbox, Microsandbox, etc.) fail, instead of throwing an error, the system"
anchors:
  - Overview
  - Architecture
  - Features
  - 1. **Graceful Degradation**
  - 2. **User-Friendly Modal UI**
  - 3. **Failure Reason Detection**
  - 4. **Action Suggestions**
  - Files
  - Core Implementation
  - Integration Points
  - Usage
  - Basic Usage
  - With Custom Options
  - Handling Modal Actions
  - Modal Provider API
  - ModalSandboxProvider
  - ModalSandboxHandle
  - ModalState
  - Integration with Existing Systems
  - Session Manager
  - Terminal Manager
  - Testing
  - Configuration
  - Environment Variables (Optional)
  - Best Practices
  - Monitoring
  - Troubleshooting
  - Modal Not Showing
  - Execution Still Failing
  - Provider Not in Fallback Chain
  - Future Enhancements
  - Related Documentation
---
# Modal Sandbox Provider - Last Resort Fallback

## Overview

The **Modal Sandbox Provider** is the absolute last fallback in the binG sandbox provider chain. When all other sandbox providers (Daytona, E2B, Sprites, CodeSandbox, Microsandbox, etc.) fail, instead of throwing an error, the system displays a user-friendly modal UI explaining the situation and offering alternative actions.

## Architecture

```
Provider Fallback Chain:
daytona (priority: 1)
  ↓
e2b (priority: 2)
  ↓
runloop (priority: 3)
  ↓
microsandbox (priority: 4)
  ↓
blaxel (priority: 5)
  ↓
sprites (priority: 6)
  ↓
codesandbox (priority: 7)
  ↓
webcontainer (priority: 8)
  ↓
opensandbox (priority: 9)
  ↓
mistral (priority: 3)
  ↓
vercel-sandbox (priority: 8)
  ↓
oracle-vm (priority: 9)
  ↓
zeroboot (priority: 10)
  ↓
modal (priority: 999) ← LAST RESORT
```

## Features

### 1. **Graceful Degradation**
- Never throws unhandled errors
- Always provides user with actionable information
- Maintains application stability even when all providers fail

### 2. **User-Friendly Modal UI**
- Clear explanation of what went wrong
- Visual indicators (icons) for different failure types
- List of failed providers
- Suggested actions based on failure reason

### 3. **Failure Reason Detection**
Automatically categorizes failures into:
- `all_providers_down` - All cloud providers unavailable
- `quota_exceeded` - Usage quota exceeded
- `network_error` - Network connectivity issues
- `configuration_error` - API keys or configuration problems
- `unknown_error` - Unclassified errors

### 4. **Action Suggestions**
Context-aware suggestions based on failure type:
- **Retry** - Attempt to reconnect
- **Use Local Execution** - Switch to local mode
- **Check Status** - View provider health
- **Upgrade Quota** - Increase usage limits
- **Check Network** - Verify connectivity
- **Fix Configuration** - Update settings

## Files

### Core Implementation
- `lib/sandbox/providers/modal-provider.ts` - Modal provider class and handle
- `components/agent/sandbox-fallback-modal.tsx` - React modal component

### Integration Points
- `lib/sandbox/providers/index.ts` - Provider registry and fallback logic
- `lib/sandbox/provider-router.ts` - Provider selection and profiling

## Usage

### Basic Usage

```typescript
import { getSandboxProviderWithFallback } from '@/lib/sandbox/providers'

// Automatically falls back to modal if all providers fail
const { provider, type } = await getSandboxProviderWithFallback('daytona')

if (type === 'modal') {
  // Show modal UI to user
  const modalState = (provider as ModalSandboxProvider)
    .createSandbox({ reason: 'all_providers_down' })
    .then(h => h.getModalState())
  
  showSandboxModal(modalState)
}
```

### With Custom Options

```typescript
import { getSandboxProviderWithFallback } from '@/lib/sandbox/providers'
import type { ModalFallbackReason } from '@/lib/sandbox/providers/modal-provider'

const { provider, type } = await getSandboxProviderWithFallback('daytona', {
  allowModalFallback: true,
  modalReason: 'network_error' as ModalFallbackReason,
})
```

### Handling Modal Actions

```typescript
import { SandboxFallbackModal } from '@/components/agent/sandbox-fallback-modal'
import { modalProvider } from '@/lib/sandbox/providers/modal-provider'

function handleSandboxError() {
  const modalState = modalProvider.getActiveSandboxes()[0]?.getModalState()
  
  return (
    <SandboxFallbackModal
      modalState={modalState}
      onAction={async (action) => {
        switch (action) {
          case 'retry':
            await retrySandboxCreation()
            break
          case 'use_local':
            await switchToLocalExecution()
            break
          case 'check_status':
            await showProviderStatus()
            break
        }
      }}
      onClose={() => closeModal()}
    />
  )
}
```

## Modal Provider API

### ModalSandboxProvider

```typescript
class ModalSandboxProvider implements SandboxProvider {
  readonly name = 'modal'
  
  // Create modal sandbox handle
  async createSandbox(config: {
    reason?: ModalFallbackReason
    failedProviders?: string[]
  }): Promise<ModalSandboxHandle>
  
  // Get existing handle
  async getSandbox(sandboxId: string): Promise<ModalSandboxHandle>
  
  // Destroy handle
  async destroySandbox(sandboxId: string): Promise<void>
  
  // Get all active sandboxes
  getActiveSandboxes(): ModalSandboxHandle[]
  
  // Get modal state for UI
  getModalState(sandboxId: string): ModalState | null
}
```

### ModalSandboxHandle

```typescript
class ModalSandboxHandle implements SandboxHandle {
  readonly id: string
  readonly workspaceDir = '/modal/fallback'
  readonly createdAt: Date
  readonly reason: ModalFallbackReason
  readonly failedProviders: string[]
  
  // All execution methods return errors with helpful messages
  async executeCommand(command: string): Promise<ToolResult>
  async writeFile(filePath: string, content: string): Promise<ToolResult>
  async readFile(filePath: string): Promise<ToolResult>
  async listDirectory(dirPath: string): Promise<ToolResult>
  
  // Get modal state for UI rendering
  getModalState(): ModalState
}
```

### ModalState

```typescript
interface ModalState {
  sandboxId: string
  reason: ModalFallbackReason
  failedProviders: string[]
  createdAt: string
  suggestions: ModalSuggestion[]
}

interface ModalSuggestion {
  action: string
  label: string
  description: string
}
```

## Integration with Existing Systems

### Session Manager

```typescript
// lib/session/session-manager.ts
try {
  const { provider, type } = await getSandboxProviderWithFallback(preferredType, {
    allowModalFallback: true,
  })
  
  if (type === 'modal') {
    // Trigger UI modal instead of failing
    const handle = await provider.createSandbox({
      reason: determineFailureReason(errors),
      failedProviders: getFailedProviders(errors),
    })
    
    onModalFallback(handle.getModalState())
    return null
  }
  
  return provider
} catch (error) {
  // Handle other errors
}
```

### Terminal Manager

```typescript
// lib/terminal/terminal-manager.ts
private async createSandboxWithModalFallback(): Promise<SandboxHandle | null> {
  try {
    const { provider, type } = await getSandboxProviderWithFallback(
      this.getFallbackProviderType(),
      { allowModalFallback: true }
    )
    
    if (type === 'modal') {
      this.showModalFallback()
      return null
    }
    
    return await provider.createSandbox({})
  } catch (error) {
    this.showModalFallback(error)
    return null
  }
}
```

## Testing

```typescript
// __tests__/sandbox/modal-provider.test.ts
import { modalProvider } from '@/lib/sandbox/providers/modal-provider'

describe('ModalSandboxProvider', () => {
  it('should create modal handle with failure information', async () => {
    const handle = await modalProvider.createSandbox({
      reason: 'all_providers_down',
      failedProviders: ['daytona', 'e2b', 'sprites'],
    })
    
    expect(handle.id).toMatch(/^modal-\d+-/)
    expect(handle.reason).toBe('all_providers_down')
    expect(handle.failedProviders).toHaveLength(3)
  })
  
  it('should return modal state for UI', async () => {
    const handle = await modalProvider.createSandbox({
      reason: 'quota_exceeded',
    })
    
    const state = handle.getModalState()
    
    expect(state).toMatchObject({
      reason: 'quota_exceeded',
      suggestions: expect.arrayContaining([
        expect.objectContaining({ action: 'upgrade_quota' }),
      ]),
    })
  })
  
  it('should block all execution attempts', async () => {
    const handle = await modalProvider.createSandbox({})
    
    const result = await handle.executeCommand('ls -la')
    
    expect(result.success).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.hint).toContain('modal UI')
  })
})
```

## Configuration

The modal provider is always available and requires no configuration. It's automatically included in the fallback chain with the lowest priority (999).

### Environment Variables (Optional)

```env
# Disable modal fallback (revert to throwing errors)
SANDBOX_ALLOW_MODAL_FALLBACK=false

# Custom modal timeout (ms)
SANDBOX_MODAL_TIMEOUT=30000
```

## Best Practices

1. **Always Allow Modal Fallback**: In production, always use `allowModalFallback: true` to prevent crashes
2. **Provide Context**: Pass meaningful `modalReason` values to help users understand the issue
3. **Handle Actions**: Implement all suggested actions in the modal UI
4. **Log Failures**: Track modal fallbacks for monitoring and alerting
5. **Test Fallback**: Regularly test the modal fallback path to ensure it works

## Monitoring

Track modal fallback usage:

```typescript
// Track modal fallback metrics
sandboxMetrics.modalFallbackTotal.inc({
  reason: modalState.reason,
  failedProviders: modalState.failedProviders.join(','),
})

// Alert on high modal fallback rate
if (modalFallbackRate > 0.05) {
  alert('High modal fallback rate detected')
}
```

## Troubleshooting

### Modal Not Showing

1. Check that `allowModalFallback: true` is set
2. Verify modal provider is registered: `getAllProviders().includes('modal')`
3. Ensure React component is imported and rendered

### Execution Still Failing

The modal handle blocks all execution by design. Handle the modal state in your UI and provide alternative actions (retry, local execution, etc.).

### Provider Not in Fallback Chain

Check priority in registry:
```typescript
const entry = providerRegistry.get('modal')
console.log(entry?.priority) // Should be 999
```

## Future Enhancements

- [ ] Persist modal state across page reloads
- [ ] Add retry-with-different-provider option
- [ ] Integrate with provider status dashboard
- [ ] Add quota upgrade flow
- [ ] Support custom modal themes
- [ ] Add analytics tracking

## Related Documentation

- [Sandbox Providers Overview](./sandbox-providers.md)
- [Provider Router](./provider-router.md)
- [Execution Policies](./execution-policies.md)
- [Error Handling](./error-handling.md)
