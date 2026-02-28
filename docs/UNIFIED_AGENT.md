# Unified Agent System (V1 + V2)

## Overview

The Unified Agent System provides a single interface that seamlessly integrates:

- **V1: LLM Chat API** - Cloud-based LLM providers (Mistral, Google, OpenRouter, OpenCode API)
- **V2: OpenCode Containerized** - Locally hosted OpenCode CLI running in isolated sandboxes

The system automatically routes requests based on configuration and implements fallback chains for maximum reliability.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  /api/unified-agent                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │          Unified Agent Service                        │   │
│  │  - Mode detection (auto/v1/v2)                        │   │
│  │  - Health checking                                    │   │
│  │  - Fallback chain                                     │   │
│  └──────────────────────────────────────────────────────┘   │
│           │                    │                             │
│    ┌──────┴──────┐      ┌─────┴─────┐                       │
│    │  V1 Mode    │      │ V2 Mode   │                       │
│    │  (API)      │      │ (OpenCode)│                       │
│    │             │      │           │                       │
│    │ - Mistral   │      │ - Local   │                       │
│    │ - Google    │      │ - Sandbox │                       │
│    │ - OpenRouter│      │           │                       │
│    │ - OpenCode  │      │           │                       │
│    └─────────────┘      └───────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### V1 Mode (LLM API) - Default

```bash
# .env
LLM_PROVIDER=mistral
MISTRAL_API_KEY=your_mistral_key

# Run
pnpm dev
```

### V2 Mode (OpenCode Containerized)

```bash
# .env
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=true
OPENCODE_MODEL=claude-3-5-sonnet
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_daytona_key

# Run with Docker
docker-compose --profile opencode up app-opencode
```

## API Reference

### POST /api/unified-agent

Send a message to the unified agent.

**Request:**
```json
{
  "message": "Create a React component",
  "systemPrompt": "You are a React expert",
  "history": [
    { "role": "user", "content": "Previous message" }
  ],
  "tools": [
    {
      "name": "createFile",
      "description": "Create a file",
      "parameters": { "type": "object", ... }
    }
  ],
  "mode": "auto",  // auto | v1-api | v2-containerized | v2-local
  "maxSteps": 15,
  "temperature": 0.7,
  "maxTokens": 4096
}
```

**Response (JSON):**
```json
{
  "success": true,
  "response": "Here's the component...",
  "steps": [
    {
      "toolName": "createFile",
      "args": { "path": "Component.tsx", "content": "..." },
      "result": { "success": true, "output": "File created" }
    }
  ],
  "totalSteps": 1,
  "mode": "v2-containerized",
  "metadata": {
    "provider": "opencode",
    "duration": 2345
  }
}
```

**Response (Streaming):**
```
Accept: text/event-stream

data: {"type":"stream","text":"Here's "}
data: {"type":"stream","text":"the component"}
data: {"type":"tool_execution","toolName":"createFile",...}
data: {"type":"complete","response":"...","mode":"v2-containerized"}
```

### GET /api/unified-agent

Get provider health status and available modes.

**Response:**
```json
{
  "health": {
    "v2Containerized": true,
    "v2Local": false,
    "v1Api": true,
    "preferredMode": "v2-containerized"
  },
  "modes": [
    {
      "mode": "v2-containerized",
      "name": "OpenCode Containerized",
      "description": "Run OpenCode CLI in isolated sandbox",
      "available": true
    },
    {
      "mode": "v1-api",
      "name": "LLM API",
      "description": "Use cloud LLM APIs",
      "available": true
    }
  ],
  "environment": {
    "LLM_PROVIDER": "opencode",
    "OPENCODE_CONTAINERIZED": "true",
    "SANDBOX_PROVIDER": "daytona"
  }
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | Primary LLM provider | `mistral` |
| `OPENCODE_CONTAINERIZED` | Enable V2 containerized mode | `false` |
| `OPENCODE_MODEL` | Model for OpenCode CLI | - |
| `OPENCODE_SESSION_ID` | Persistent session ID | - |
| `SANDBOX_PROVIDER` | Sandbox provider for V2 | `daytona` |
| `DAYTONA_API_KEY` | Daytona API key | - |

### Mode Selection

**Automatic (Recommended):**
```bash
# System automatically selects best available mode
mode: "auto"
```

**Manual Override:**
```bash
# Force V1 API mode
mode: "v1-api"

# Force V2 containerized
mode: "v2-containerized"

# Force V2 local (opencode CLI on host)
mode: "v2-local"
```

## Fallback Chain

The system implements automatic fallback:

```
V2 Containerized (fails)
    ↓
V2 Local (fails)
    ↓
V1 API (fallback)
```

Fallback occurs when:
- Sandbox provider unavailable
- API rate limits hit
- Timeout errors
- Tool execution failures

## Tool Execution

Both V1 and V2 modes support tool execution:

**V1 API Mode:**
- Uses LLM provider's native tool calling (if supported)
- Falls back to agent loop for providers without tool support

**V2 Containerized Mode:**
- Full tool support via OpenCode CLI
- Tools execute in isolated sandbox
- Supports file operations, shell commands, etc.

## Examples

### Example 1: Simple Chat (V1)

```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Hello!',
    mode: 'auto',
  }),
});

const data = await response.json();
console.log(data.response);
```

### Example 2: Code Generation with Tools (V2)

```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Create a React button component',
    mode: 'v2-containerized',
    tools: [
      {
        name: 'createFile',
        description: 'Create a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
    ],
    maxSteps: 10,
  }),
});

const data = await response.json();
console.log('Steps:', data.steps);
console.log('Response:', data.response);
```

### Example 3: Streaming Response

```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  },
  body: JSON.stringify({
    message: 'Write a poem',
  }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  const events = chunk.split('\n\n');
  
  for (const event of events) {
    if (event.startsWith('data: ')) {
      const data = JSON.parse(event.slice(6));
      
      if (data.type === 'stream') {
        console.log(data.text);
      } else if (data.type === 'complete') {
        console.log('Done:', data.response);
      }
    }
  }
}
```

## Migration Guide

### From V1 Only

If you're currently using `/api/chat`:

1. Update endpoint: `/api/chat` → `/api/unified-agent`
2. Request format is compatible (no changes needed)
3. Enable V2 mode by setting `OPENCODE_CONTAINERIZED=true`

### From V2 Only

If you're currently using `/api/sandbox/agent`:

1. Update endpoint: `/api/sandbox/agent` → `/api/unified-agent`
2. Same environment variables work
3. Falls back to V1 if sandbox unavailable

## Troubleshooting

### V2 Mode Not Available

Check:
```bash
# Verify sandbox provider
echo $SANDBOX_PROVIDER
echo $DAYTONA_API_KEY

# Check health
curl http://localhost:3000/api/unified-agent
```

### Fallback Always Triggered

Check provider health:
```bash
curl http://localhost:3000/api/unified-agent | jq .health
```

### Tool Execution Fails

- Ensure tools are properly defined with schemas
- Check sandbox has required permissions
- Verify `executeTool` callback is provided

## Performance

**V1 API Mode:**
- Latency: 200-1000ms (network dependent)
- Throughput: High (no sandbox overhead)

**V2 Containerized Mode:**
- Latency: 500-2000ms (sandbox startup)
- Throughput: Medium (sandbox isolated)
- Better for: Complex multi-step tasks

## Security

- V2 mode provides sandbox isolation
- File operations restricted to workspace
- Command blocklist prevents dangerous operations
- JWT authentication required

## See Also

- [OpenCode Provider](../lib/sandbox/providers/opencode-provider.ts)
- [LLM Providers](../lib/api/llm-providers.ts)
- [Sandbox Agent Loop](../lib/sandbox/agent-loop.ts)
