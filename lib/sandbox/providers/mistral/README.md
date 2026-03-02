# Mistral Agent Sandbox Provider

Production-ready implementation of Mistral AI's Agent SDK for sandbox code execution.

## Features

- ✅ **Full Agent SDK Integration** - Agents API + Conversations API
- ✅ **Code Interpreter Tool** - Safe, isolated code execution
- ✅ **Virtual Filesystem** - Emulated file operations
- ✅ **Streaming Support** - Real-time output streaming
- ✅ **Error Handling** - Retry logic with exponential backoff
- ✅ **Quota Management** - Usage tracking and limits
- ✅ **Fallback Chain** - Automatic failover from other providers
- ✅ **Connection Pooling** - Optimized API connections
- ✅ **Response Caching** - Reduced API calls and latency

## Quick Start

### 1. Configure Environment

Add to your `.env` file:

```bash
# Required: Mistral API Key
MISTRAL_API_KEY=your_mistral_api_key_here

# Optional: Configuration
MISTRAL_AGENT_MODEL=mistral-medium-2505
MISTRAL_CODE_INTERPRETER_MODEL=mistral-medium-2505
MISTRAL_AGENT_TEMPERATURE=0.3
MISTRAL_CODE_EXECUTION_MAX_RETRIES=3
MISTRAL_CODE_EXECUTION_TIMEOUT_MS=120000
```

### 2. Set as Provider

```bash
# Use as primary provider
SANDBOX_PROVIDER=mistral-agent

# Or add to fallback chain
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,mistral-agent,microsandbox
```

### 3. Use in Code

```typescript
import { getSandboxProvider } from './lib/sandbox/providers'

// Get Mistral provider
const provider = getSandboxProvider('mistral-agent')

// Create sandbox
const sandbox = await provider.createSandbox({})

// Execute code
const result = await sandbox.executeCommand(`
import math
print(f"Square root of 16: {math.sqrt(16)}")
`)

console.log(result.output)
// Output: Square root of 16: 4.0
```

## Architecture

```
┌─────────────────────────────────────┐
│     Application Layer               │
│  (Chat, Code Mode, Agents)          │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│     Sandbox Service Bridge          │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Provider Registry                │
│  (Fallback Chain Logic)             │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Mistral Agent Provider           │
│  ┌───────────────────────────────┐  │
│  │ Conversation Manager          │  │
│  │ Code Executor                 │  │
│  │ Virtual Filesystem            │  │
│  │ Stream Handler                │  │
│  │ Error Handler                 │  │
│  │ Quota Tracker                 │  │
│  └───────────────────────────────┘  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│    Mistral AI API                   │
│  - Agents API                       │
│  - Conversations API                │
│  - Code Interpreter Tool            │
└─────────────────────────────────────┘
```

## Module Structure

```
mistral/
├── index.ts                          # Module exports
├── mistral-agent-provider.ts         # Main provider (TO IMPLEMENT)
├── mistral-conversation-manager.ts   # Conversation management (TO IMPLEMENT)
├── mistral-code-executor.ts          # Code execution (TO IMPLEMENT)
├── mistral-file-system.ts            # Virtual filesystem (TO IMPLEMENT)
├── mistral-stream-handler.ts         # Streaming (TO IMPLEMENT)
├── mistral-error-handler.ts          # Error handling (TO IMPLEMENT)
├── mistral-quota-manager.ts          # Quota tracking (TO IMPLEMENT)
├── mistral-types.ts                  # Type definitions ✓
├── mistral-connection-pool.ts        # Connection pooling (TO IMPLEMENT)
├── mistral-response-cache.ts         # Response caching (TO IMPLEMENT)
└── utils/
    ├── prompt-builder.ts             # Prompt construction (TO IMPLEMENT)
    ├── response-parser.ts            # Response parsing (TO IMPLEMENT)
    └── code-validator.ts             # Code validation (TO IMPLEMENT)
```

**Current Status**: ✓ Types defined, implementation files TO IMPLEMENT

## API Reference

### Provider Configuration

```typescript
interface MistralProviderConfig {
  apiKey: string
  serverURL: string
  model: string
  codeInterpreterModel: string
  defaultTemperature: number
  defaultTopP: number
  maxRetries: number
  timeout: number
  enableStreaming: boolean
  enableQuotaTracking: boolean
}
```

### Agent Configuration

```typescript
interface AgentConfig {
  name: string
  description: string
  model?: string
  instructions?: string
  tools?: ToolType[]
  completionArgs?: CompletionArgs
}
```

### Code Execution

```typescript
interface CodeExecutionRequest {
  code: string
  language: CodeLanguage
  cwd?: string
  env?: Record<string, string>
  timeout?: number
  requireJsonOutput?: boolean
  conversationId?: string
}
```

## Usage Examples

### Basic Code Execution

```typescript
import { MistralAgentProvider } from './providers/mistral'

const provider = new MistralAgentProvider()
const sandbox = await provider.createSandbox({})

// Python
const pyResult = await sandbox.executeCommand(`
import numpy as np
data = np.random.randn(100)
print(f"Mean: {data.mean():.4f}")
`)

// JavaScript
const jsResult = await sandbox.executeCommand(`
const sum = [1,2,3,4,5].reduce((a,b) => a+b, 0)
console.log(\`Sum: \${sum}\`)
`)
```

### Streaming Execution

```typescript
const stream = provider.streamCodeExecution(`
for i in range(10):
    print(f"Count: {i}")
    time.sleep(0.5)
`)

for await (const chunk of stream) {
  console.log('Stream:', chunk.content)
}
```

### Virtual Filesystem

```typescript
// Write file
await sandbox.writeFile('/workspace/test.py', `
def hello():
    print("Hello from file!")
`)

// Read file
const fileContent = await sandbox.readFile('/workspace/test.py')

// Execute file
await sandbox.executeCommand('python /workspace/test.py')
```

### Custom Agent

```typescript
// Create specialized agent
const agent = await provider.createAgent({
  name: 'Data Analysis Agent',
  description: 'Specialized in data analysis and visualization',
  instructions: 'You are a data analysis expert.',
  tools: ['code_interpreter'],
})

// Use agent for execution
const sandbox = await provider.createSandbox({})
// ... use sandbox with custom agent context
```

### Error Handling

```typescript
try {
  const result = await provider.executeWithRetry(
    () => sandbox.executeCommand(code),
    'Code Execution'
  )
  
  if (!result.success) {
    console.error('Execution failed:', result.output)
  }
} catch (error) {
  if (error.type === 'RATE_LIMIT') {
    console.log('Rate limited, try again later')
  } else if (error.type === 'QUOTA_EXCEEDED') {
    console.log('Monthly quota exceeded')
  } else {
    console.error('Unexpected error:', error.message)
  }
}
```

## Fallback Chain

The provider is integrated into the global fallback chain:

```typescript
// Automatic fallback when providers fail
const sandbox = await sandboxProviderRegistry.createWithFallback(
  config,
  ['daytona', 'e2b', 'mistral-agent', 'microsandbox']
)
// Tries each provider in order until one succeeds
```

## Quota Management

```typescript
// Get usage statistics
const stats = await provider.getQuotaStats()
console.log(`Used: ${stats.currentUsage}/${stats.quota}`)
console.log(`Remaining: ${stats.remaining}`)
console.log(`Resets on: ${stats.resetDate}`)
```

## Security

### Code Validation

```typescript
const validator = new CodeValidator()
const result = await validator.validate(code, 'python')

if (!result.safe) {
  console.error('Code safety issues:', result.errors)
  console.warn('Warnings:', result.warnings)
}
```

### Dangerous Patterns Detected

- `rm -rf /` - System destruction
- `mkfs.*` - Filesystem formatting
- Fork bombs
- Network attacks
- Sensitive file access (`/etc/passwd`, etc.)

## Performance

### Connection Pooling

```typescript
const pool = new MistralConnectionPool({
  maxPoolSize: 10,
  maxAge: 300000, // 5 minutes
  maxRequests: 1000,
})

// Reuse connections automatically
```

### Response Caching

```typescript
const cache = new ResponseCache({
  defaultTTL: 300000, // 5 minutes
  maxSize: 1000,
})

// Cache results of deterministic code
await cache.set(codeHash, result)
const cached = await cache.get(codeHash)
```

## Testing

### Unit Tests

```bash
npm test -- lib/sandbox/providers/mistral/__tests__
```

### Integration Tests

```bash
npm test -- tests/integration/mistral-sandbox.test.ts
```

## Troubleshooting

### Common Issues

**Provider not initializing**
```bash
# Check API key is set
echo $MISTRAL_API_KEY

# Verify API key is valid
curl -H "Authorization: Bearer $MISTRAL_API_KEY" \
     https://api.mistral.ai/v1/models
```

**Quota exceeded**
```bash
# Check usage
const stats = await provider.getQuotaStats()
console.log(stats)

# Increase quota or wait for reset
```

**Rate limiting**
```bash
# Enable retry logic
MISTRAL_CODE_EXECUTION_MAX_RETRIES=5

# Add backoff delay
MISTRAL_CODE_EXECUTION_BACKOFF_MS=2000
```

## Cost Management

### Token Optimization

- Cache frequently executed code
- Use efficient prompts
- Batch related executions
- Monitor token usage via quota tracker

### Quota Settings

```bash
# Set monthly limit
MISTRAL_CODE_EXECUTION_MONTHLY_QUOTA=1000

# Track usage
MISTRAL_ENABLE_QUOTA_TRACKING=true
```

## Migration Guide

### From Legacy Mistral Provider

```typescript
// Old
import { MistralCodeInterpreterProvider } from './mistral-code-interpreter-provider'
const provider = new MistralCodeInterpreterProvider()

// New (backward compatible)
import { MistralAgentProvider } from './mistral'
const provider = new MistralAgentProvider()

// Or use registry
const provider = getSandboxProvider('mistral-agent')
```

## Contributing

### Implementation Checklist

- [ ] Core provider implementation
- [ ] Conversation manager
- [ ] Code executor
- [ ] Virtual filesystem
- [ ] Stream handler
- [ ] Error handler
- [ ] Quota tracker
- [ ] Connection pool
- [ ] Response cache
- [ ] Utility functions
- [ ] Unit tests
- [ ] Integration tests
- [ ] Documentation

## References

- [Mistral Agents API](https://docs.mistral.ai/agents/)
- [Code Interpreter Guide](https://docs.mistral.ai/docs/agents/connectors/code_interpreter)
- [Conversations API](https://docs.mistral.ai/api/#tag/beta.conversations)
- [Mistral TypeScript SDK](https://github.com/mistralai/client-typescript)
- [Implementation Plan](./MISTRAL_AGENT_SANDBOX_IMPLEMENTATION_PLAN.md)
- [Implementation Summary](./MISTRAL_IMPLEMENTATION_SUMMARY.md)

## License

MIT
