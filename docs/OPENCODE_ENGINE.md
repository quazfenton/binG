# OpenCode Engine - Primary Agentic System

## Overview

**OpenCode Engine** is now the PRIMARY agentic engine for the application, replacing manual LLM call handling and custom tool simulation.

### What Changed

**Before (V1 API Mode):**
```
User → LLM API → Custom Tool Simulation → Manual Bash → Custom File Ops
     ↓
   You manage: reasoning loops, error handling, context, tool calling
```

**After (OpenCode Engine Mode):**
```
User → OpenCode CLI → Native Bash + File Ops → Built-in Agentic Reasoning
     ↓
   OpenCode manages: reasoning, tools, error recovery, context
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  /api/unified-agent                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         OpenCode Engine (PRIMARY)                     │   │
│  │  - Native bash command execution                      │   │
│  │  - Built-in file operations                           │   │
│  │  - Agentic reasoning loops                            │   │
│  │  - Tool calling integrated                            │   │
│  │  - Session persistence                                │   │
│  └──────────────────────────────────────────────────────┘   │
│           ↓                                                  │
│    ┌──────┴──────┐                                          │
│    │  Local      │      Containerized                       │
│    │  (spawn)    │      (sandbox)                           │
│    │             │                                          │
│    │ opencode CLI│      opencode in                         │
│    │ on host     │      Daytona/E2B                         │
│    └─────────────┘                                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         V1 LLM API (FALLBACK ONLY)                    │   │
│  │  - Simple chat when OpenCode unavailable              │   │
│  │  - No agentic capabilities                            │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Why OpenCode as Primary?

### Benefits

1. **Native Tool Execution**
   - Bash commands: Built-in, no simulation
   - File operations: Read, write, edit, diff - all native
   - No custom tool definitions needed

2. **Built-in Agentic Reasoning**
   - OpenCode handles multi-step reasoning
   - Automatic error recovery
   - Context management built-in

3. **Session Persistence**
   - Conversation history automatically managed
   - Context files stored between sessions
   - No custom session management needed

4. **Less Code to Maintain**
   - Remove custom tool simulation code
   - Remove custom agentic loops
   - Leverage OpenCode's battle-tested implementation

5. **Better Performance**
   - Single process instead of LLM API + tool calls
   - Lower latency (no network round-trips for tools)
   - More efficient context handling

## Configuration

### Local Mode (Development)

```bash
# .env
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=false
OPENCODE_MODEL=claude-3-5-sonnet

# Install opencode CLI
npm install -g opencode
```

### Containerized Mode (Production)

```bash
# .env
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=true
OPENCODE_MODEL=claude-3-5-sonnet
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_key
```

### Fallback to V1 API

```bash
# .env
LLM_PROVIDER=mistral  # or google, openrouter, etc.
MISTRAL_API_KEY=your_key

# OpenCode unavailable, falls back to V1 API
```

## API Usage

### Basic Request

```typescript
POST /api/unified-agent
{
  "message": "Create a React button component",
  "mode": "auto"  // Auto-selects OpenCode Engine
}
```

**Response:**
```json
{
  "success": true,
  "response": "I've created the button component...",
  "steps": [
    {
      "toolName": "execute_command",
      "args": { "command": "mkdir -p components" },
      "result": { "success": true, "output": "", "exitCode": 0 }
    },
    {
      "toolName": "execute_command",
      "args": { "command": "cat > components/Button.tsx << 'EOF'..." },
      "result": { "success": true, "output": "...", "exitCode": 0 }
    }
  ],
  "totalSteps": 2,
  "mode": "v2-local",
  "metadata": {
    "provider": "opencode-engine",
    "duration": 2345,
    "commandsExecuted": 2,
    "filesModified": 1
  }
}
```

### With System Prompt

```typescript
POST /api/unified-agent
{
  "message": "Refactor the authentication module",
  "systemPrompt": "You are a senior TypeScript developer. Focus on security and best practices.",
  "maxSteps": 20
}
```

### Streaming Response

```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  },
  body: JSON.stringify({
    message: "Build a todo app",
  }),
});

// Process SSE stream...
```

## Session Management

OpenCode Engine automatically manages sessions:

```typescript
// Sessions stored in: /tmp/opencode-context/{userId}/{sessionId}.json

// Automatic session creation
POST /api/unified-agent
{ "message": "Hello" }
// → Creates session, returns sessionId

// Continue conversation
POST /api/unified-agent
{ 
  "message": "Continue from before",
  "history": [{ "role": "user", "content": "Hello" }]
}
// → Uses existing session
```

## Tool Execution Tracking

All tool execution is tracked and returned:

```json
{
  "commandsExecuted": [
    {
      "command": "npm install react",
      "output": "added 142 packages...",
      "exitCode": 0
    }
  ],
  "filesModified": [
    { "path": "package.json", "action": "modify" },
    { "path": "src/App.tsx", "action": "create" }
  ]
}
```

## Migration Guide

### From Custom Agentic System

**Before:**
```typescript
// Custom tool definitions
const tools = [
  {
    name: 'executeCommand',
    description: 'Run bash command',
    parameters: { command: z.string() },
  },
  {
    name: 'writeFile',
    description: 'Write file',
    parameters: { path: z.string(), content: z.string() },
  },
];

// Manual tool execution
const result = await llm.generateResponse({ messages, tools });
const toolCall = result.toolCalls[0];
await executeTool(toolCall.name, toolCall.args);
```

**After:**
```typescript
// No tool definitions needed!
const result = await fetch('/api/unified-agent', {
  method: 'POST',
  body: JSON.stringify({ message: 'Create a file' }),
});

// OpenCode handles tools natively
const data = await result.json();
console.log(data.steps); // Native tool execution
```

### From V1 API Only

**Before:**
```bash
LLM_PROVIDER=mistral
```

**After:**
```bash
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=false

# Install opencode
npm install -g opencode
```

## Performance Comparison

| Metric | V1 API | OpenCode Engine |
|--------|--------|-----------------|
| **Latency (simple)** | 500-2000ms | 200-1000ms |
| **Latency (tools)** | 2000-10000ms | 500-3000ms |
| **Tool Calls** | Network + API | Native (fast) |
| **Context Limit** | API dependent | Local (larger) |
| **Cost/Request** | $0.002-0.01 | $0.0001 (compute) |

## Error Handling

OpenCode Engine provides detailed error information:

```json
{
  "success": false,
  "response": "",
  "error": "OpenCode process error: Command not found",
  "metadata": {
    "mode": "v2-local",
    "duration": 1234
  }
}
```

**Common Errors:**

1. **`opencode not found`**
   ```bash
   npm install -g opencode
   ```

2. **`E2B_API_KEY not configured`**
   ```bash
   echo "E2B_API_KEY=your_key" >> .env
   ```

3. **`Process timed out`**
   ```bash
   # Increase timeout
   echo "OPENCODE_TIMEOUT=600000" >> .env
   ```

## Health Check

Check OpenCode availability:

```bash
curl http://localhost:3000/api/unified-agent | jq
```

**Response:**
```json
{
  "health": {
    "openCodeAvailable": true,
    "v2Local": true,
    "v2Containerized": false,
    "v1Api": true,
    "preferredMode": "v2-local"
  },
  "modes": [
    {
      "mode": "opencode-engine",
      "name": "OpenCode Engine (Recommended)",
      "available": true,
      "recommended": true
    }
  ]
}
```

## Best Practices

1. **Use OpenCode for agentic tasks**
   - File operations
   - Code generation
   - Multi-step workflows

2. **Use V1 API for simple chat**
   - Quick questions
   - No tool execution needed
   - Low-latency responses

3. **Set appropriate limits**
   ```bash
   maxSteps=15  # Prevent infinite loops
   maxTokens=4096  # Control API costs
   timeout=300000  # 5 minute timeout
   ```

4. **Monitor resource usage**
   ```bash
   # Check memory/CPU
   htop
   # Check OpenCode processes
   ps aux | grep opencode
   ```

## Troubleshooting

### OpenCode Not Responding

```bash
# Check installation
opencode --version

# Check PATH
which opencode

# Reinstall if needed
npm install -g opencode
```

### Session Issues

```bash
# Clear old sessions
rm -rf /tmp/opencode-context/*

# Check session files
ls -la /tmp/opencode-context/
```

### Tool Execution Fails

```bash
# Check sandbox permissions
# For containerized mode:
echo $SANDBOX_PROVIDER
echo $DAYTONA_API_KEY

# For local mode:
# Ensure user has bash/file permissions
```

## See Also

- [Unified Agent Documentation](./UNIFIED_AGENT.md)
- [OpenCode Provider](../lib/sandbox/providers/opencode-provider.ts)
- [OpenCode Engine Service](../lib/api/opencode-engine-service.ts)
