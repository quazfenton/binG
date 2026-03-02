# OpenCode V2 Engine - Primary Agentic Backend

## Overview

The **OpenCode V2 Engine** is now the **primary agentic backend** for the application, replacing manual LLM call handling with native OpenCode CLI integration.

### What Changed

**Before (V1 / Manual LLM):**
```
User → LLM API → Parse response → Simulate tools → Execute → Return
```
- Manual agentic simulation
- Limited bash/file operations
- Custom tool calling logic
- No native command execution

**After (V2 / OpenCode Engine):**
```
User → OpenCode CLI → Native bash/tools → Real execution → Structured result
```
- Native agentic reasoning
- Real bash command execution
- Actual file system operations  
- Built-in tool calling
- Multi-step planning

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  /api/unified-agent                          │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         OpenCode V2 Engine (PRIMARY)                  │   │
│  │  - Native bash execution                              │   │
│  │  - Real file operations                               │   │
│  │  - Built-in tool calling                              │   │
│  │  - Multi-step reasoning                               │   │
│  └──────────────────────────────────────────────────────┘   │
│           │                    │                             │
│    ┌──────┴──────┐      ┌─────┴─────┐                       │
│    │   Native    │      │Container- │                       │
│    │   (local)   │      │  ized     │                       │
│    │             │      │ (sandbox) │                       │
│    └─────────────┘      └───────────┘                       │
│                              ↓                               │
│                    ┌───────────────┐                        │
│                    │  V1 API       │                        │
│                    │  (Fallback)   │                        │
│                    └───────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Modes

### V2 Native (Recommended) ⭐
```bash
# .env
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=false

# Requires: npm install -g opencode
```
- Runs OpenCode CLI directly on your machine
- Full bash and file system access
- Lowest latency
- Best for development

### V2 Containerized (Production)
```bash
# .env
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=true
SANDBOX_PROVIDER=daytona  # or e2b, blaxel
```
- Runs OpenCode CLI in isolated sandbox
- Secure, resource-limited
- Best for production/multi-user

### V1 API (Fallback)
```bash
# .env
LLM_PROVIDER=mistral  # or google, openrouter
```
- Cloud LLM APIs only
- Simple chat, no agentic features
- Automatic fallback if V2 unavailable

## Installation

### 1. Install OpenCode CLI
```bash
# Global install (V2 Native)
npm install -g opencode

# Or use in sandbox (V2 Containerized)
# Auto-installed when needed
```

### 2. Configure Environment
```bash
# Primary: OpenCode V2 Engine
LLM_PROVIDER=opencode
OPENCODE_MODEL=claude-3-5-sonnet
OPENCODE_CONTAINERIZED=false  # true for sandbox mode

# Optional: Sandbox for containerized mode
SANDBOX_PROVIDER=daytona
DAYTONA_API_KEY=your_key
```

### 3. Verify Installation
```bash
# Check OpenCode availability
opencode --version

# Check API health
curl http://localhost:3000/api/unified-agent
```

## Usage

### Basic Task
```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: 'Create a React button component with TypeScript',
    mode: 'auto',  // Auto-selects V2 Native
  }),
});

const result = await response.json();
console.log(result.response);
console.log(result.steps);  // Bash commands, file changes
```

### With Tool Execution
```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  body: JSON.stringify({
    message: 'Refactor the auth module to use JWT',
    maxSteps: 20,
    systemPrompt: 'You are a senior engineer. Use bash and file ops.',
  }),
});

const data = await response.json();
// {
//   response: "I've refactored the auth module...",
//   steps: [
//     { toolName: 'execute_bash', args: { command: 'npm install jsonwebtoken' } },
//     { toolName: 'file_operation', args: { path: 'lib/auth.ts', action: 'modify' } },
//   ],
//   mode: 'v2-native',
// }
```

### Streaming Mode
```typescript
const response = await fetch('/api/unified-agent', {
  method: 'POST',
  headers: { 'Accept': 'text/event-stream' },
  body: JSON.stringify({ message: 'Build a todo app' }),
});

const reader = response.body.getReader();
// Process SSE events: chunk, tool, bash, complete
```

## Capabilities

### Native Bash Execution
```json
{
  "bashCommands": [
    {
      "command": "npm install express",
      "output": "added 15 packages",
      "exitCode": 0
    },
    {
      "command": "git status",
      "output": "On branch main...",
      "exitCode": 0
    }
  ]
}
```

### File Operations
```json
{
  "fileChanges": [
    {
      "path": "src/components/Button.tsx",
      "action": "create",
      "content": "export const Button = ..."
    },
    {
      "path": "package.json",
      "action": "modify"
    }
  ]
}
```

### Multi-Step Reasoning
```
Task: "Add authentication to the API"

Steps:
1. Analyze current codebase
2. Install dependencies (bash)
3. Create auth middleware (file)
4. Update routes (file)
5. Add tests (file)
6. Run tests (bash)
```

## Performance

| Metric | V2 Native | V2 Containerized | V1 API |
|--------|-----------|------------------|---------|
| Latency | 200-500ms | 500-2000ms | 200-1000ms |
| Memory | 500MB | 1-3GB | 150MB |
| CPU | 2-4 cores | 4-8 cores | 0.5-1 core |
| Cost/task | ~$0.001 | ~$0.01 | ~$0.005 |

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | Set to `opencode` for V2 | `mistral` |
| `OPENCODE_MODEL` | Model for OpenCode | `claude-3-5-sonnet` |
| `OPENCODE_CONTAINERIZED` | Enable sandbox mode | `false` |
| `OPENCODE_BIN` | Custom opencode path | `opencode` |
| `SANDBOX_PROVIDER` | Sandbox for containerized | `daytona` |

### Mode Selection

```typescript
// Auto (recommended)
{ "mode": "auto" }

// Force V2 Native
{ "mode": "v2-native" }

// Force V2 Containerized
{ "mode": "v2-containerized" }

// Force V1 API (fallback)
{ "mode": "v1-api" }
```

## Migration Guide

### From Manual LLM Calls

**Before:**
```typescript
// Manual LLM + custom tool simulation
const llm = await callLLM(prompt);
const tools = parseToolCalls(llm);
for (const tool of tools) {
  await executeTool(tool);
}
```

**After:**
```typescript
// OpenCode handles everything natively
const result = await fetch('/api/unified-agent', {
  body: JSON.stringify({ message: 'Do X' }),
});
// result includes bash commands, file changes, etc.
```

### From V1 API

**Before:**
```bash
LLM_PROVIDER=mistral
```

**After:**
```bash
LLM_PROVIDER=opencode
OPENCODE_CONTAINERIZED=false
```

## Troubleshooting

### OpenCode Not Found
```bash
# Install globally
npm install -g opencode

# Or check PATH
which opencode
```

### Quota Exceeded
```bash
# Check usage
curl http://localhost:3000/api/unified-agent | jq .health

# Increase limits in .env
QUOTA_E2B_MONTHLY=1000
```

### Fallback Triggered
```bash
# Check provider health
curl http://localhost:3000/api/unified-agent

# Verify configuration
echo $LLM_PROVIDER
echo $OPENCODE_CONTAINERIZED
```

## API Reference

### POST /api/unified-agent

**Request:**
```json
{
  "message": "Task description",
  "systemPrompt": "Optional system prompt",
  "mode": "auto",
  "maxSteps": 20,
  "history": [...]
}
```

**Response:**
```json
{
  "success": true,
  "response": "Task completed",
  "steps": [...],
  "mode": "v2-native",
  "metadata": {
    "provider": "opencode-engine",
    "duration": 2345,
    "tokensUsed": 1500
  }
}
```

### GET /api/unified-agent

Get provider health and available modes.

**Response:**
```json
{
  "health": {
    "v2Native": true,
    "v2Containerized": false,
    "v1Api": true,
    "preferredMode": "v2-native"
  },
  "modes": [
    {
      "mode": "v2-native",
      "name": "OpenCode Engine",
      "available": true,
      "recommended": true
    }
  ]
}
```

## See Also

- [Unified Agent Documentation](./UNIFIED_AGENT.md)
- [OpenCode Provider](../lib/sandbox/providers/opencode-provider.ts)
- [OpenCode Engine Service](../lib/api/opencode-engine-service.ts)
