---
id: spawn-containerized-ai-coding-agents
title: Containerized AI Coding Agents
aliases:
  - CONTAINERIZED_AI_AGENTS
  - CONTAINERIZED_AI_AGENTS.md
  - containerized-ai-coding-agents
  - containerized-ai-coding-agents.md
tags:
  - agent
  - spawn
layer: core
summary: "# Containerized AI Coding Agents\r\n\r\n## Overview\r\n\r\nbinG now supports **containerized AI coding agents** that run as isolated Docker containers or connect to remote server APIs. Each agent provides advanced coding capabilities with persistent sessions, workspace access, and streaming events.\r\n\r\n### S"
anchors:
  - Overview
  - Supported Agents
  - Quick Start
  - 1. Install Dependencies
  - 2. Configure Environment
  - 3. Usage Examples
  - Claude Code Agent
  - Amp Agent
  - Agent Service Manager (Advanced)
  - Architecture
  - Container Structure
  - Request Flow
  - Agent Capabilities
  - Claude Code
  - Amp
  - Configuration Options
  - Agent Config
  - Model Selection
  - Event Streaming
  - Health Monitoring
  - Security Considerations
  - Container Isolation
  - API Key Management
  - Resource Limits
  - Troubleshooting
  - Agent Won't Start
  - Health Check Failing
  - Memory Issues
  - Performance Tips
  - Migration Guide
  - From CLI-based to Containerized
relations:
  - type: implements
    id: spawn-containerized-ai-agents-implementation-summary
    title: Containerized AI Agents - Implementation Summary
    path: spawn/containerized-ai-agents-implementation-summary.md
    confidence: 0.375
    classified_score: 0.38
    auto_generated: true
    generator: apply-classified-suggestions
---
# Containerized AI Coding Agents

## Overview

binG now supports **containerized AI coding agents** that run as isolated Docker containers or connect to remote server APIs. Each agent provides advanced coding capabilities with persistent sessions, workspace access, and streaming events.

### Supported Agents

| Agent | Provider | Best For | Context | Price |
|-------|----------|----------|---------|-------|
| **Claude Code** | Anthropic | Complex refactoring, multi-file edits | 200K tokens | $15/1M input |
| **Amp** | OpenAI | Code generation, rapid prototyping | 128K tokens | $7.50/1M input |
| **OpenCode** | Open Source | General coding tasks, customization | 100K tokens | Free |

## Quick Start

### 1. Install Dependencies

```bash
pnpm add dockerode
```

### 2. Configure Environment

```bash
# .env.local

# Claude Code
ANTHROPIC_API_KEY=sk-ant-...

# Amp (OpenAI)
OPENAI_API_KEY=sk-...

# Agent settings
AGENT_AUTO_STOP_TIMEOUT=3600  # Auto-stop after 1 hour idle
AGENT_CPU_LIMIT=2             # CPU cores per agent
AGENT_MEMORY_LIMIT=2g         # Memory per agent
```

### 3. Usage Examples

#### Claude Code Agent

```typescript
import { createClaudeCodeAgent } from '@/lib/agents';

const claude = await createClaudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  workspaceDir: '/workspace/my-project',
  model: 'claude-sonnet-4-5-20250929',
});

// Refactor code
const result = await claude.prompt({
  message: 'Refactor the authentication module to use JWT',
  timeout: 300000,
});

console.log(result.response);
console.log('Files modified:', result.filesModified);

// Execute terminal command
const cmdResult = await claude.executeCommand('npm test');
console.log(cmdResult);

await claude.stop();
```

#### Amp Agent

```typescript
import { createAmpAgent } from '@/lib/agents';

const amp = await createAmpAgent({
  apiKey: process.env.OPENAI_API_KEY,
  workspaceDir: '/workspace/my-project',
  model: 'amp-coder-1',
  temperature: 0.7,
});

// Generate code
const code = await amp.generateCode(
  'A React hook for fetching data with caching',
  'typescript'
);

// Review code
const review = await amp.reviewCode(code, 'src/hooks/useFetch.ts');

// Generate tests
const tests = await amp.generateTests(code, 'jest');

await amp.stop();
```

#### Agent Service Manager (Advanced)

```typescript
import { getAgentServiceManager } from '@/lib/agents';

const manager = getAgentServiceManager();

// Start multiple agents
const [claude, amp] = await Promise.all([
  manager.startAgent({
    type: 'claude-code',
    workspaceDir: '/workspace/project-1',
    apiKey: process.env.ANTHROPIC_API_KEY,
  }),
  manager.startAgent({
    type: 'amp',
    workspaceDir: '/workspace/project-2',
    apiKey: process.env.OPENAI_API_KEY,
  }),
]);

// Send prompts
const [claudeResult, ampResult] = await Promise.all([
  manager.prompt(claude.agentId, { message: 'Add logging' }),
  manager.prompt(amp.agentId, { message: 'Optimize queries' }),
]);

// Subscribe to events
const events = await manager.subscribe(claude.agentId);
for await (const event of events) {
  console.log(`${event.type}:`, event.data);
}

// Clean up idle agents
await manager.cleanupIdleAgents(3600000); // 1 hour
```

## Architecture

### Container Structure

```
┌─────────────────────────────────────────┐
│         Docker Host                     │
│                                         │
│  ┌─────────────┐  ┌─────────────┐      │
│  │ Claude Code │  │    Amp      │      │
│  │  Container  │  │  Container  │      │
│  │             │  │             │      │
│  │  Port 8080  │  │  Port 3000  │      │
│  │  /workspace │  │  /workspace │      │
│  └──────┬──────┘  └──────┬──────┘      │
│         │                │              │
│         └────────┬───────┘              │
│                  │                      │
│         ┌────────▼────────┐            │
│         │ Agent Manager   │            │
│         │ (Node.js)       │            │
│         └─────────────────┘            │
└─────────────────────────────────────────┘
```

### Request Flow

```
User Prompt
    │
    ▼
┌─────────────────┐
│ Agent Manager   │
│ - Port mapping  │
│ - Health check  │
│ - Event stream  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Docker Container│
│ - AI Agent      │
│ - Workspace     │
│ - Tools         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ File System     │
│ - Read/Write    │
│ - Git ops       │
│ - Commands      │
└─────────────────┘
```

## Agent Capabilities

### Claude Code

| Feature | Description |
|---------|-------------|
| **File Operations** | Read, write, edit files with search/replace |
| **Terminal Access** | Execute bash commands with working directory |
| **Git Integration** | Commit, diff, branch operations |
| **Multi-file Editing** | Coordinate changes across multiple files |
| **Tool Use** | Built-in tools for common operations |

**Example Tools:**
```typescript
const tools = {
  Edit: { file_path, search, replace },
  WriteFile: { file_path, content },
  ReadFile: { file_path },
  RunBash: { command, working_dir },
};
```

### Amp

| Feature | Description |
|---------|-------------|
| **Code Generation** | Generate code from descriptions |
| **Code Review** | Analyze code quality and suggest improvements |
| **Test Generation** | Create comprehensive test suites |
| **Refactoring** | Improve code structure |
| **Documentation** | Write docs and comments |

**Example Tools:**
```typescript
const tools = {
  read_file: { path },
  write_file: { path, content },
  edit_file: { path, diff },
  run_command: { command, cwd },
  search_code: { pattern, path },
};
```

## Configuration Options

### Agent Config

```typescript
interface AgentConfig {
  type: 'claude-code' | 'amp' | 'opencode';
  agentId?: string;           // Auto-generated if not provided
  workspaceDir: string;       // Required: directory to mount
  apiKey: string;             // Required: API key
  env?: Record<string, string>;
  image?: string;             // Custom container image
  port?: number;              // Exposed port
  containerName?: string;
  autoStopTimeout?: number;   // Seconds until auto-stop
  resources?: {
    cpu?: number;             // CPU cores (default: 2)
    memory?: string;          // Memory limit (default: 2g)
  };
}
```

### Model Selection

```typescript
// Claude Code models
const claudeModels = {
  'claude-sonnet-4-5-20250929': 'Best for coding (fast, accurate)',
  'claude-opus-4-5-20250929': 'Most capable (complex tasks)',
  'claude-haiku-4-5-20250929': 'Fastest (simple tasks)',
};

// Amp models
const ampModels = {
  'amp-coder-1': 'Latest coding model',
  'amp-coder-mini': 'Faster, less capable',
  'amp-coder-max': 'Most capable, slower',
};
```

## Event Streaming

Subscribe to real-time agent events:

```typescript
const events = await agent.subscribe();

for await (const event of events) {
  switch (event.type) {
    case 'message':
      console.log('Agent:', event.data.content);
      break;
    case 'tool_call':
      console.log(`Calling ${event.data.name}:`, event.data.arguments);
      break;
    case 'file_change':
      console.log(`Modified ${event.data.path}:`, event.data.action);
      break;
    case 'status_change':
      console.log(`Status: ${event.data.status}`);
      break;
    case 'error':
      console.error('Error:', event.data.message);
      break;
  }
}
```

## Health Monitoring

```typescript
import { getAgentServiceManager } from '@/lib/agents';

const manager = getAgentServiceManager();

// Check all agents
const agents = manager.listAgents();
for (const agent of agents) {
  const healthy = await manager.checkAgentHealth(agent);
  console.log(`${agent.agentId}: ${healthy ? '✓' : '✗'}`);
}

// Auto-cleanup idle agents
await manager.cleanupIdleAgents(3600000); // 1 hour
```

## Security Considerations

### Container Isolation

- Each agent runs in isolated Docker container
- Workspace directory mounted read-write
- No host filesystem access
- Network isolated (only exposed port accessible)

### API Key Management

```typescript
// ✅ Good: Use environment variables
const agent = await createAgent('claude-code', {
  apiKey: process.env.ANTHROPIC_API_KEY,
  workspaceDir: '/workspace/project',
});

// ❌ Bad: Don't hardcode keys
const agent = await createAgent('claude-code', {
  apiKey: 'sk-ant-...',  // Never do this!
  workspaceDir: '/workspace/project',
});
```

### Resource Limits

```typescript
// Prevent resource exhaustion
const agent = await manager.startAgent({
  type: 'claude-code',
  workspaceDir: '/workspace/project',
  apiKey: process.env.ANTHROPIC_API_KEY,
  resources: {
    cpu: 2,      // Limit to 2 cores
    memory: '2g', // Limit to 2GB RAM
  },
  autoStopTimeout: 3600, // Auto-stop after 1 hour idle
});
```

## Troubleshooting

### Agent Won't Start

```bash
# Check Docker is running
docker ps

# Check API key
echo $ANTHROPIC_API_KEY

# Check workspace exists
ls -la /workspace/my-project
```

### Health Check Failing

```typescript
// Enable debug logging
process.env.DEBUG = 'Agents:*';

// Check container logs
const { getAgentServiceManager } = await import('@/lib/agents');
const manager = getAgentServiceManager();
const agent = manager.getAgent('agent-id');

// Docker logs
const Docker = require('dockerode');
const docker = new Docker();
const container = docker.getContainer(agent.containerId);

const logs = await container.logs({
  stdout: true,
  stderr: true,
  follow: false,
});
```

### Memory Issues

```typescript
// Increase memory limit
const agent = await manager.startAgent({
  ...config,
  resources: {
    cpu: 4,
    memory: '4g',
  },
});
```

## Performance Tips

1. **Reuse Agents**: Keep agents alive for multiple prompts
2. **Clear Sessions**: Call `clearSession()` to free memory
3. **Auto-Stop**: Set `autoStopTimeout` to clean up idle agents
4. **Batch Operations**: Send multiple instructions in one prompt
5. **Stream Responses**: Use `stream: true` for faster first token

## Migration Guide

### From CLI-based to Containerized

**Before (CLI):**
```typescript
import { exec } from 'child_process';

exec('claude "refactor this"', (err, stdout) => {
  console.log(stdout);
});
```

**After (Containerized):**
```typescript
import { createClaudeCodeAgent } from '@/lib/agents';

const claude = await createClaudeCodeAgent({
  apiKey: process.env.ANTHROPIC_API_KEY,
  workspaceDir: '/workspace/project',
});

const result = await claude.prompt({
  message: 'Refactor this',
});

console.log(result.response);
await claude.stop();
```

**Benefits:**
- ✅ Persistent sessions
- ✅ File system access
- ✅ Streaming events
- ✅ Better error handling
- ✅ Resource isolation
