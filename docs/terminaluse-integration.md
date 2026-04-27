---
id: terminaluse-integration
title: TerminalUse Integration
aliases:
  - terminaluse-integration
  - terminaluse-integration.md
tags:
  - terminal
layer: core
summary: "# TerminalUse Integration\r\n\r\nTerminalUse provides cloud agents with persistent filesystems and sandboxed compute for binG.\r\n\r\n## Overview\r\n\r\nTerminalUse integration adds:\r\n- **Persistent Filesystems**: Storage mounted at `/workspace` across task executions\r\n- **Task/Event Streaming**: Real-time inte"
anchors:
  - Overview
  - Architecture
  - Core Model
  - Primitives
  - Workflows
  - Deploy Loop (Versioning & Deployment)
  - Run Loop (Execution & Interaction)
  - Runtime Mounts
  - Task Lifecycle
  - Lifecycle Hooks
  - Typical Flow
  - Event Flow & Data Scope
  - Filesystem Sync Behavior
  - Configuration
  - Environment Variables
  - Provider Configuration
  - Usage
  - Basic Sandbox Operations
  - Agent Execution
  - Streaming Events
  - Filesystem Operations
  - Batch Jobs
  - API Routes
  - Create Task
  - Stream Task Events
  - Send Event
  - List Filesystems
  - Comparison with Other Providers
  - Quotas and Limits
  - Error Handling
  - Testing
  - Troubleshooting
  - Task Creation Fails
  - Filesystem Operations Fail
  - Streaming Disconnects
  - Resources
relations:
  - type: implements
    id: terminaluse-integration-summary
    title: TerminalUse Integration Summary
    path: terminaluse-integration-summary.md
    confidence: 0.381
    classified_score: 0.4
    auto_generated: true
    generator: apply-classified-suggestions
  - type: related
    id: terminal-use
    title: Terminal Use
    path: terminal-use.md
    confidence: 0.32
    classified_score: 0.265
    auto_generated: true
    generator: apply-classified-suggestions
  - type: example-of
    id: websocket-terminal-integration-guide
    title: WebSocket Terminal Integration Guide
    path: websocket-terminal-integration-guide.md
    confidence: 0.318
    classified_score: 0.399
    auto_generated: true
    generator: apply-classified-suggestions
---
# TerminalUse Integration

TerminalUse provides cloud agents with persistent filesystems and sandboxed compute for binG.

## Overview

TerminalUse integration adds:
- **Persistent Filesystems**: Storage mounted at `/workspace` across task executions
- **Task/Event Streaming**: Real-time interaction with agents via SSE
- **State Management**: Agent memory and state persistence (per task/agent)
- **Agent-to-Client Protocol (ACP)**: Standardized task creation and management
- **Python Runtime**: Sandboxed Python execution with system folders (`/root/.claude`, `/root/.codex`)
- **Task Lifecycle Hooks**: `on_create`, `on_event`, `on_cancel` handlers

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    binG Application                          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  TerminalUse Provider                                │  │
│  │  - TerminalUseProvider (SandboxProvider interface)   │  │
│  │  - TerminalUseClient (API client)                    │  │
│  │  - TerminalUseSandboxHandle (SandboxHandle)          │  │
│  └─────────────────────────────────────────────────────┘  │
│           │                      │                        │
│           ▼                      ▼                        │
│  ┌──────────────┐      ┌──────────────────┐             │
│  │  Agent       │      │  Filesystem      │             │
│  │  Service     │      │  Operations      │             │
│  └──────────────┘      └──────────────────┘             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              TerminalUse Cloud Platform                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Tasks      │  │  Filesystems │  │    State     │    │
│  │  (Agents)    │  │  (Storage)   │  │  (Memory)    │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                            │
│  Primitives:                                               │
│  - Namespace: Isolation boundary                          │
│  - Project: Filesystem permission boundary                │
│  - Agent: Deployed Python runtime                         │
│  - Branch/Version: Deployment slots                       │
│  - Event/Message: Input/Output                            │
└─────────────────────────────────────────────────────────────┘
```

## Core Model

### Primitives

| Primitive | Definition | Purpose |
|-----------|------------|---------|
| **Namespace** | Isolation boundary for compute and storage | Most teams start with one namespace |
| **Project** | Collaboration and permission boundary for filesystems | Customer- or workflow-level access control |
| **Filesystem** | Persistent files mounted into tasks at `/workspace` | Shared storage across tasks |
| **Agent** | Your deployed Python runtime | Each deploy creates a new version |
| **Environment** | Named deployment policy (e.g., production, preview) | Branch rules resolve to environments |
| **Branch** | Deployment slot for a git branch | Points at the current active version |
| **Version** | One deployed build of an agent | Tasks are created against a specific version |
| **Task** | One running conversation or unit of work | Holds state, messages, events, filesystem |
| **Event** | Input sent to a task | Usually user text or structured data |
| **Message** | Output emitted by the agent | Assistant text, UI parts, tool output |
| **State** | Per-task persisted JSON | Continuity across turns |

### Workflows

#### Deploy Loop (Versioning & Deployment)
```
Write/Change Code → `tu deploy` → New Version → Active on Branch's Environment
```

#### Run Loop (Execution & Interaction)
```
Choose Filesystem → Create Task → Send Events → Read Messages/State → Pull Filesystem
```

### Runtime Mounts

When a task runs with a filesystem attached:
- **`/workspace`**: The mounted filesystem (read-only if no update permission)
- **`/root/.claude`**: Task-scoped Claude state (when used)
- **`/root/.codex`**: Task-scoped Codex state (when used)
- **Agent Code**: Mounted separately and read-only inside the sandbox

## Task Lifecycle

### Lifecycle Hooks

The TerminalUse Python runtime exposes three handlers:

| Hook | Trigger | Sync Behavior |
|------|---------|---------------|
| **`@server.on_create`** | Task is initialized | Filesystem synced **before** handler |
| **`@server.on_event`** | App sends follow-up events | Filesystem synced **before** handler |
| **`@server.on_cancel`** | Task is cancelled | **No sync** - workspace changes not persisted |

### Typical Flow

1. **Creation**: App creates task with `agent_name` or `agent_id`
2. **Filesystem Attachment**: Optional - attach existing `filesystem_id` or create from `project_id`
3. **Version Resolution**: TerminalUse resolves target version for requested branch
4. **Initialization**: Runtime calls `on_create` handler
5. **Execution**: App sends events → Runtime calls `on_event`
6. **Output**: Agent emits messages and updates state
7. **Termination**: If cancelled, Runtime calls `on_cancel`

### Event Flow & Data Scope

| Component | Scope |
|-----------|-------|
| Messages | Per task |
| Events | Per task |
| State | Per task **and** agent |
| ResourceScope | Per task |
| System Folders | Per task |
| Filesystem Mount | Shared (if same filesystem attached) |

### Filesystem Sync Behavior

- **Sync Timing**: 
  - Syncs into `/workspace` **before** `on_create` and `on_event`
  - Syncs changes back **after** handlers complete
- **Cancellation**: `on_cancel` runs with **sync disabled**
- **Permissions**: `/workspace` mounted **read-only** without filesystem update permission

## Configuration

### Environment Variables

```env
# Required: TerminalUse API Key
TERMINALUSE_API_KEY=tu_your_api_key_here

# Optional: Custom API base URL
#TERMINALUSE_BASE_URL=https://api.terminaluse.com

# Optional: Default namespace for agents
#TERMINALUSE_NAMESPACE=my-namespace

# Optional: Default project for filesystems
#TERMINALUSE_PROJECT_ID=proj_xxxxx

# Optional: Monthly quota
QUOTA_TERMINALUSE_MONTHLY=5000
```

### Provider Configuration

Add `terminaluse` to your sandbox provider fallback chain:

```env
SANDBOX_PROVIDER=terminaluse
# or
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,terminaluse,modal-com,mistral-agent,modal
```

## Usage

### Basic Sandbox Operations

```typescript
import { TerminalUseProvider } from '@/lib/sandbox/providers/terminaluse-provider'

const provider = new TerminalUseProvider()

// Create sandbox with persistent filesystem
const handle = await provider.createSandbox({
  envVars: {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  },
  labels: {
    project_id: 'proj_xxxxx', // Links to a project for filesystem
  },
})

// Execute commands
const result = await handle.executeCommand('python --version')
console.log(result.output)

// Write/read files (persisted to filesystem)
await handle.writeFile('/workspace/script.py', 'print("Hello")')
const content = await handle.readFile('/workspace/script.py')

// List directory
const files = await handle.listDirectory('/workspace')

// Cleanup
await provider.destroySandbox(handle.id)
```

### Agent Execution

```typescript
import { createTerminalUseAgentService } from '@/lib/sandbox/spawn/terminaluse-agent-service'
import { TerminalUseProvider } from '@/lib/sandbox/providers/terminaluse-provider'

const provider = new TerminalUseProvider()
const handle = await provider.createSandbox({})

const agentService = createTerminalUseAgentService(handle)

// Run agent with prompt
const result = await agentService.run({
  agent_name: 'my-namespace/my-agent',
  prompt: 'Refactor the codebase to use TypeScript',
  streamEvents: true,
  onEvent: (event) => {
    console.log('Event:', event)
  },
})

console.log('Task ID:', result.taskId)
console.log('Output:', result.output)

// Continue conversation
const continued = await agentService.continue(result.taskId, 'Now add tests')

// Access state
const state = await agentService.getState(result.taskId)
console.log('Agent state:', state)

// Update state
await agentService.setState(result.taskId, { step: 'testing' })
```

### Streaming Events

```typescript
// Stream task events in real-time
for await (const event of agentService.streamEvents({
  agent_name: 'my-namespace/my-agent',
  prompt: 'Add error handling',
})) {
  if (event.content.type === 'text') {
    console.log('Agent:', event.content.text)
  }
}
```

### Filesystem Operations

```typescript
// Get filesystem ID
const filesystemId = handle.getFilesystemId()

// List files
const files = await handle.callAgent({
  targetAgent: '',
  input: { action: 'list_files', path: '/workspace' },
})

// Upload/download via API
const { TerminalUseClient } = await import('@/lib/sandbox/providers/terminaluse-provider')
const client = new TerminalUseClient({ apiKey: process.env.TERMINALUSE_API_KEY! })

// Upload file
await client.uploadFile({
  filesystem_id: filesystemId!,
  file_path: '/workspace/data.json',
  content: JSON.stringify({ hello: 'world' }),
})

// Download file
const file = await client.getFile({
  filesystem_id: filesystemId!,
  file_path: '/workspace/data.json',
  include_content: true,
})
console.log(file.content)
```

### Batch Jobs

```typescript
// Execute multiple tasks in batch
const batchResult = await handle.runBatchJob([
  { id: 'task1', data: { prompt: 'Analyze file A' } },
  { id: 'task2', data: { prompt: 'Analyze file B' } },
], {
  maxRetries: 2,
})

console.log(`Completed: ${batchResult.completedTasks}/${batchResult.totalTasks}`)
```

## API Routes

### Create Task

```bash
POST /api/sandbox/terminaluse/tasks
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "agent_name": "my-namespace/my-agent",
  "prompt": "Refactor the codebase",
  "branch": "main",
  "params": { "mode": "aggressive" }
}
```

### Stream Task Events

```bash
GET /api/sandbox/terminaluse/tasks/:id/stream
Authorization: Bearer <jwt_token>

# Returns SSE stream
data: {"type": "text", "text": "Thinking..."}
data: {"type": "data", "data": {"step": "analysis"}}
```

### Send Event

```bash
POST /api/sandbox/terminaluse/tasks/:id/events
Content-Type: application/json
Authorization: Bearer <jwt_token>

{
  "content": "Continue with the refactoring",
  "persist_message": true
}
```

### List Filesystems

```bash
GET /api/sandbox/terminaluse/filesystems?project_id=proj_xxxxx
Authorization: Bearer <jwt_token>
```

## Comparison with Other Providers

| Feature | TerminalUse | E2B | Daytona | Blaxel |
|---------|-------------|-----|---------|--------|
| Persistent Storage | ✓ Filesystems | ✓ Templates | ✓ Workspaces | ✓ Volumes |
| Task Streaming | ✓ SSE | ✓ | ✓ | ✓ |
| State Management | ✓ Native | ✗ | ✗ | ✗ |
| Agent Protocol | ✓ ACP | ✗ | ✗ | ✗ |
| Python Runtime | ✓ | ✓ | ✓ | ✓ |
| Multi-turn Conversations | ✓ Threads | ✓ Threads | ✗ | ✗ |
| Cold Start Time | ~2-5s | ~1-3s | ~5-10s | <1s |
| Best For | Stateful agents | Code execution | Dev environments | Fast resume |

## Quotas and Limits

- **Monthly Tasks**: Configured via `QUOTA_TERMINALUSE_MONTHLY` (default: 5000)
- **Task Timeout**: Default 1 hour, configurable per task
- **Filesystem Size**: Depends on TerminalUse plan
- **Concurrent Tasks**: Depends on TerminalUse plan

## Error Handling

```typescript
try {
  const result = await agentService.run({ ... })
} catch (error: any) {
  if (error.message.includes('TERMINALUSE_API_KEY')) {
    console.error('TerminalUse not configured')
  } else if (error.message.includes('quota')) {
    console.error('Monthly quota exceeded')
  } else {
    console.error('Task failed:', error.message)
  }
}
```

## Testing

```bash
# Run TerminalUse integration tests
pnpm test:terminaluse

# Run with live sandbox (requires API key)
ENABLE_LIVE_TERMINALUSE_TESTS=true pnpm test:terminaluse
```

## Troubleshooting

### Task Creation Fails

1. Verify `TERMINALUSE_API_KEY` is set
2. Check agent name format: `namespace/agent`
3. Verify agent is deployed in TerminalUse dashboard

### Filesystem Operations Fail

1. Ensure `project_id` is provided during sandbox creation
2. Check filesystem status is `READY`
3. Verify file paths are absolute

### Streaming Disconnects

1. Increase task timeout for long-running operations
2. Implement reconnection logic in client
3. Check network connectivity

## Resources

- [TerminalUse Documentation](https://docs.terminaluse.com/)
- [API Reference](https://docs.terminaluse.com/api-reference)
- [ADK Reference](https://docs.terminaluse.com/api-reference/adk)
- [Quick Start](https://docs.terminaluse.com/introduction/quickstart)
