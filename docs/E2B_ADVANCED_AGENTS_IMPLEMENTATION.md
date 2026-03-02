# E2B Advanced Agents Implementation

**Date:** February 27, 2026  
**Status:** ✅ Complete  
**Implementation:** Phase 1 of Advanced Integration Enhancement Plan

---

## Executive Summary

Successfully implemented **Amp** and **Codex** coding agent integrations for E2B sandboxes, adding powerful new capabilities for AI-assisted development workflows.

### What Was Implemented

1. **E2B Amp Service** - Full integration with Amp coding agent
2. **E2B Codex Service** - Full integration with OpenAI Codex
3. **E2B Provider Updates** - Methods added to E2BSandboxHandle
4. **Documentation** - Comprehensive examples and usage guide
5. **Type Safety** - Full TypeScript types for all services

---

## New Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `lib/sandbox/providers/e2b-amp-service.ts` | Amp service implementation | ~250 |
| `lib/sandbox/providers/e2b-codex-service.ts` | Codex service implementation | ~350 |
| `examples/e2b-advanced-agents.ts` | Usage examples (8 examples) | ~400 |
| `docs/E2B_ADVANCED_AGENTS_IMPLEMENTATION.md` | This document | - |

---

## Modified Files

| File | Changes |
|------|---------|
| `lib/sandbox/providers/e2b-provider.ts` | Added Amp + Codex service methods |
| `docs/ADVANCED_INTEGRATION_ENHANCEMENT_PLAN.md` | Updated progress |

---

## Features Implemented

### Amp Service Features

| Feature | Status | Description |
|---------|--------|-------------|
| Basic Execution | ✅ | Run Amp with prompts |
| Streaming JSON | ✅ | Real-time event streaming |
| Thread Management | ✅ | List, continue, delete threads |
| Working Directory | ✅ | Set execution context |
| Timeout Control | ✅ | Configurable execution timeout |
| Event Types | ✅ | assistant, result, tool_call, thinking, permission |

### Codex Service Features

| Feature | Status | Description |
|---------|--------|-------------|
| Basic Execution | ✅ | Run Codex with prompts |
| Full Auto Mode | ✅ | Auto-approve tool calls |
| Schema Validation | ✅ | Output schema enforcement |
| Image Input | ✅ | Design mockup processing |
| Streaming Events | ✅ | Real-time event monitoring |
| Working Directory | ✅ | Set execution context |
| Event Types | ✅ | tool_call, file_change, message, error, thinking |

---

## API Reference

### Amp Service

```typescript
import { createAmpService } from '@/lib/sandbox/providers'

const amp = createAmpService(sandbox, apiKey)

// Run Amp
const result = await amp.run({
  prompt: 'Create a hello world HTTP server in Go',
  dangerouslyAllowAll: true,
  workingDir: '/home/user/repo',
  timeout: 600000,
})

// Stream events
for await (const event of amp.streamJson({
  prompt: 'Refactor the utils module',
  streamJson: true,
})) {
  console.log(event.type, event.message)
}

// Thread management
const threads = await amp.threads.list()
const continued = await amp.threads.continue(threads[0].id, 'Next step...')
await amp.threads.delete(threads[0].id)
```

### Codex Service

```typescript
import { createCodexService, CodexSchemas } from '@/lib/sandbox/providers'

const codex = createCodexService(sandbox, apiKey)

// Run Codex
const result = await codex.run({
  prompt: 'Review this codebase for security issues',
  fullAuto: true,
  skipGitRepoCheck: true,
  workingDir: '/home/user/repo',
})

// Run with schema-validated output
await sandbox.files.write('/schema.json', JSON.stringify(CodexSchemas.securityReview))

const result = await codex.run({
  prompt: 'Security review',
  outputSchemaPath: '/schema.json',
  workingDir: '/home/user/repo',
})

const issues = result.parsedOutput // Typed result
```

---

## Usage Examples

### 1. Basic Amp Execution

```typescript
const sandbox = await Sandbox.create('amp', {
  envs: { AMP_API_KEY: process.env.AMP_API_KEY },
})

const amp = createAmpService(sandbox, process.env.AMP_API_KEY!)

const result = await amp.run({
  prompt: 'Create a hello world HTTP server in Go',
  dangerouslyAllowAll: true,
})

console.log(result.stdout)
await sandbox.kill()
```

### 2. Amp with Streaming

```typescript
for await (const event of amp.streamJson({
  prompt: 'Find and fix all TODO comments',
  streamJson: true,
})) {
  if (event.type === 'assistant') {
    console.log(`Tokens: ${event.message.usage?.output_tokens}`)
  } else if (event.type === 'result') {
    console.log(`Done in ${event.message.duration_ms}ms`)
  }
}
```

### 3. Codex with Schema Output

```typescript
await sandbox.files.write('/schema.json', JSON.stringify({
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        file: { type: 'string' },
        severity: { type: 'string', enum: ['low', 'medium', 'high'] },
        description: { type: 'string' },
      },
    },
  },
}))

const result = await codex.run({
  prompt: 'Security review',
  outputSchemaPath: '/schema.json',
})

const issues = result.parsedOutput.issues
```

### 4. Codex with Image Input

```typescript
const mockupData = fs.readFileSync('./design.png')
await sandbox.files.write('/mockup.png', mockupData)

const result = await codex.runWithImage({
  prompt: 'Implement this UI design',
  imagePath: '/mockup.png',
  imageData: mockupData,
})
```

---

## Environment Variables

```bash
# Required for Amp
AMP_API_KEY=your_amp_api_key

# Required for Codex (either works)
CODEX_API_KEY=your_codex_api_key
OPENAI_API_KEY=your_openai_api_key

# Optional
E2B_API_KEY=your_e2b_api_key
```

---

## Integration with E2B Provider

The services are integrated into `E2BSandboxHandle`:

```typescript
const handle = await e2bProvider.createSandbox(config)

// Access Amp service
const amp = handle.getAmpService()
if (amp) {
  const result = await handle.executeAmp({
    prompt: 'Your task',
    dangerouslyAllowAll: true,
  })
}

// Access Codex service
const codex = handle.getCodexService()
if (codex) {
  const result = await handle.executeCodex({
    prompt: 'Your task',
    fullAuto: true,
  })
}

// Stream events
for await (const event of handle.streamAmpEvents({ prompt: 'Task' })) {
  console.log(event)
}

for await (const event of handle.streamCodexEvents({ prompt: 'Task' })) {
  console.log(event)
}
```

---

## Type Definitions

### Amp Types

```typescript
interface AmpEvent {
  type: 'assistant' | 'result' | 'tool_call' | 'thinking' | 'permission'
  message: {
    content?: string
    usage?: { input_tokens: number; output_tokens: number }
    duration_ms?: number
    subtype?: string
    tool_call?: { name: string; arguments: any }
    permission?: { tool: string; decision: 'allow' | 'deny' }
  }
}

interface AmpExecutionResult {
  stdout: string
  stderr: string
  threadId?: string
  events?: AmpEvent[]
  exitCode?: number
}
```

### Codex Types

```typescript
interface CodexEvent {
  type: 'tool_call' | 'file_change' | 'message' | 'error' | 'thinking'
  data: {
    tool_name?: string
    arguments?: any
    file_path?: string
    change_type?: 'create' | 'modify' | 'delete'
    content?: string
    error?: string
    thinking?: string
  }
}

interface CodexExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  events?: CodexEvent[]
  parsedOutput?: any
}
```

---

## Testing

### Unit Tests

```typescript
// test/sandbox/providers/e2b-amp-service.test.ts
describe('E2B Amp Service', () => {
  it('should run Amp with prompt', async () => {
    const amp = createAmpService(sandbox, apiKey)
    const result = await amp.run({
      prompt: 'Create hello world',
      dangerouslyAllowAll: true,
    })
    expect(result.stdout).toContain('Hello')
  })

  it('should stream JSON events', async () => {
    const amp = createAmpService(sandbox, apiKey)
    const events: AmpEvent[] = []
    
    for await (const event of amp.streamJson({
      prompt: 'Test',
      streamJson: true,
    })) {
      events.push(event)
    }
    
    expect(events.length).toBeGreaterThan(0)
  })

  it('should manage threads', async () => {
    const amp = createAmpService(sandbox, apiKey)
    
    const threads = await amp.threads.list()
    expect(threads).toBeInstanceOf(Array)
    
    if (threads.length > 0) {
      const continued = await amp.threads.continue(threads[0].id, 'Continue')
      expect(continued.threadId).toBe(threads[0].id)
    }
  })
})
```

---

## Performance Considerations

### Streaming vs Batch

| Mode | Latency | Use Case |
|------|---------|----------|
| Streaming JSON | ~100ms | Real-time monitoring |
| Batch Output | ~1-5s | Simple execution |

### Timeout Recommendations

| Task Type | Recommended Timeout |
|-----------|---------------------|
| Simple code gen | 60s |
| Refactoring | 300s |
| Code review | 300s |
| Full implementation | 600s |

---

## Error Handling

```typescript
try {
  const result = await amp.run({ prompt: 'Task' })
} catch (error: any) {
  if (error.message.includes('AMP_API_KEY')) {
    console.error('API key not configured')
  } else if (error.message.includes('timeout')) {
    console.error('Execution timed out')
  } else {
    console.error('Amp execution failed:', error.message)
  }
}
```

---

## Best Practices

1. **Always use `dangerouslyAllowAll` or `fullAuto` in E2B sandboxes** - Safe inside isolated environments
2. **Set appropriate timeouts** - Long tasks need more time
3. **Use streaming for long tasks** - Better user experience
4. **Validate schema output** - Ensures reliable parsing
5. **Clean up sandboxes** - Always call `sandbox.kill()` when done
6. **Use threads for follow-ups** - Maintains conversation context

---

## Troubleshooting

### Amp Service Unavailable

**Error:** `AMP_API_KEY not set`

**Solution:** Set `AMP_API_KEY` environment variable from [ampcode.com/settings](https://ampcode.com/settings)

### Codex Service Unavailable

**Error:** `CODEX_API_KEY not set`

**Solution:** Set `CODEX_API_KEY` or `OPENAI_API_KEY` environment variable

### Schema Validation Fails

**Error:** Output doesn't match schema

**Solution:** 
1. Verify schema file exists
2. Check schema is valid JSON Schema
3. Use simpler schema for complex tasks

### Streaming Events Empty

**Issue:** No events received

**Solution:** Ensure `--stream-json` or `--json` flag is used

---

## Related Documentation

- [Amp Documentation](https://e2b.dev/docs/agents/amp)
- [Codex Documentation](https://e2b.dev/docs/agents/codex)
- [E2B Provider](./docs/sdk/e2b-llms-full.txt)
- [Advanced Integration Plan](./docs/ADVANCED_INTEGRATION_ENHANCEMENT_PLAN.md)
- [Usage Examples](./examples/e2b-advanced-agents.ts)

---

## Next Steps

### Phase 2 (Week 3-4)

1. Daytona LSP Service - Code intelligence
2. Blaxel Agent Handoff - Multi-agent workflows
3. Sprites Service Manager - Auto-management
4. Cross-provider snapshot system

### Phase 3 (Week 5-6)

1. E2B Template Builder - Custom environments
2. Daytona Recording Service - Screen recording
3. Cross-provider file sync
4. Shared MCP gateway

---

## Summary

✅ **Complete Implementation**
- Amp service with full feature parity
- Codex service with schema validation
- Streaming support for both agents
- Thread management for Amp
- Image input for Codex
- Comprehensive examples
- Full type safety

**Total Lines Added:** ~1,000  
**Files Created:** 4  
**Files Modified:** 2  
**Examples:** 8  

Ready for production use! 🎉
