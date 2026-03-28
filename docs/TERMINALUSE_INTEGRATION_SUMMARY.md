# TerminalUse Integration Summary

## Overview

This document summarizes the complete TerminalUse integration for binG, providing cloud agents with persistent filesystems and sandboxed compute.

## What Was Built

### 1. Core Provider (`lib/sandbox/providers/terminaluse-provider.ts`)

**1,168 lines** - Full implementation of TerminalUse sandbox provider

#### Components:
- **`TerminalUseClient`**: Complete REST API client
  - Tasks CRUD + streaming
  - Filesystems CRUD + file operations
  - State management
  - Messages and events
  - Agents, branches, versions
  - Namespaces and projects
  
- **`TerminalUseProvider`**: Implements `SandboxProvider` interface
  - `createSandbox()`: Creates task with optional filesystem
  - `getSandbox()`: Retrieves existing sandbox
  - `destroySandbox()`: Cancels task and cleanup
  - `isAvailable()`: Checks API key configuration
  - `healthCheck()`: Verifies API connectivity

- **`TerminalUseSandboxHandle`**: Implements `SandboxHandle` interface
  - Standard operations: `executeCommand`, `writeFile`, `readFile`, `listDirectory`
  - TerminalUse-specific: `createTask`, `sendEvent`, `streamTask`, `getState`, `updateState`
  - Extended capabilities: `runBatchJob`, `executeAsync`, `streamLogs`, `callAgent`
  - Filesystem operations with persistence

### 2. Agent Service (`lib/sandbox/spawn/terminaluse-agent-service.ts`)

**552 lines** - High-level agent orchestration (similar to E2B AMP/Codex services)

#### Features:
- **`run()`**: Execute agent with prompt, optional streaming
- **`streamEvents()`**: Real-time event streaming
- **`continue()`**: Multi-turn conversations
- **`getState()` / `setState()`**: State management
- **`listThreads()`**: List all agent threads
- **`deleteThread()`**: Cleanup threads
- **`getMessages()`**: Retrieve conversation history
- **`cancelTask()`**: Cancel running tasks

### 3. API Routes (`app/api/sandbox/terminaluse/route.ts`)

**434 lines** - REST API endpoints for TerminalUse operations

#### Endpoints:
- `POST /api/sandbox/terminaluse/tasks`: Create agent tasks
- `GET /api/sandbox/terminaluse/tasks/:id/stream`: Stream task events (SSE)
- `POST /api/sandbox/terminaluse/tasks/:id/events`: Send events to tasks
- `GET /api/sandbox/terminaluse/filesystems`: List filesystems
- `POST /api/sandbox/terminaluse/filesystems`: Create filesystems

#### Features:
- JWT authentication
- Rate limiting (20 tasks/minute)
- SSE streaming for real-time updates
- Error handling and validation

### 4. Provider Registry (`lib/sandbox/providers/index.ts`)

**Updated** - TerminalUse registered as official provider

#### Changes:
- Added `terminaluse` to `SandboxProviderType` union
- Registered with priority 4 (medium-high, after E2B)
- Async factory for lazy initialization
- Health check integration
- Re-exports for public API

### 5. Tests (`__tests__/sandbox/terminaluse-provider.test.ts`)

**650+ lines** - Comprehensive unit tests

#### Coverage:
- Provider initialization and availability
- Health checks
- Sandbox creation/destruction
- Command execution
- File operations (read/write/list)
- Task management
- Event sending and streaming
- State management
- Agent service operations
- Client API methods

### 6. Documentation

#### `docs/terminaluse-integration.md` (410 lines)
- Architecture overview
- Core model (primitives, workflows)
- Task lifecycle
- Configuration
- Usage examples
- API reference
- Comparison with other providers
- Troubleshooting

#### `docs/terminaluse-quickstart.md` (350+ lines)
- Step-by-step setup guide
- CLI quickstart
- Agent scaffolding
- Deployment workflow
- Common workflows (code review, refactoring, batch analysis)
- Troubleshooting guide

#### `env.example` (Updated)
- `TERMINALUSE_API_KEY`
- `TERMINALUSE_BASE_URL`
- `TERMINALUSE_NAMESPACE`
- `TERMINALUSE_PROJECT_ID`
- `QUOTA_TERMINALUSE_MONTHLY`
- Updated `SANDBOX_PROVIDER_FALLBACK_CHAIN`

## Key Features

### Persistent Storage
- Filesystems mounted at `/workspace`
- Persists across task executions
- Shared between tasks with same filesystem
- Read-only support for limited permissions

### Real-time Streaming
- SSE (Server-Sent Events) for task events
- Bi-directional communication (send events, receive messages)
- Progress tracking and status updates

### State Management
- Per-task, per-agent state
- JSON-based persistence
- Optimistic locking support
- Continuity across conversation turns

### Task Lifecycle
- `on_create`: Initialization hook
- `on_event`: Event processing hook
- `on_cancel`: Cleanup hook
- Automatic filesystem sync around hooks

### Extended Capabilities
- Batch job execution
- Async task execution with callbacks
- Log streaming
- Agent-to-agent handoffs
- System folder sync (`/root/.claude`, `/root/.codex`)

## Architecture Integration

### binG Provider Chain
```
User Request
    ↓
Chat Interface
    ↓
Sandbox Router (priority-based fallback)
    ↓
TerminalUse Provider (priority 4)
    ↓
TerminalUse Cloud Platform
    ↓
Agent Task → Filesystem → State → Messages
```

### Data Flow
```
1. User sends message
2. binG creates TerminalUse task
3. Task initialized with filesystem (if project_id provided)
4. Agent on_create handler runs
5. User sends events via stream
6. Agent on_event handler processes
7. Agent emits messages and updates state
8. Filesystem syncs changes back
9. binG streams results to user
```

## Usage Examples

### Basic Sandbox Usage
```typescript
import { TerminalUseProvider } from '@/lib/sandbox/providers/terminaluse-provider'

const provider = new TerminalUseProvider()
const handle = await provider.createSandbox({
  labels: { project_id: 'proj_xxxxx' },
})

await handle.writeFile('/workspace/test.py', 'print("Hello")')
const result = await handle.executeCommand('python /workspace/test.py')
```

### Agent Execution
```typescript
import { createTerminalUseAgentService } from '@/lib/sandbox/spawn/terminaluse-agent-service'

const agentService = createTerminalUseAgentService(handle)
const result = await agentService.run({
  agent_name: 'my-namespace/my-agent',
  prompt: 'Refactor the codebase',
  streamEvents: true,
})
```

### API Usage
```bash
# Create task
curl -X POST http://localhost:3000/api/sandbox/terminaluse/tasks \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"agent_name":"my-agent","prompt":"Analyze code"}'

# Stream events
curl http://localhost:3000/api/sandbox/terminaluse/tasks/TASK_ID/stream
```

## Comparison with Other Providers

| Feature | TerminalUse | E2B | Daytona | Blaxel |
|---------|-------------|-----|---------|--------|
| Persistent Storage | ✓ Filesystems | ✓ Templates | ✓ Workspaces | ✓ Volumes |
| Task Streaming | ✓ SSE | ✓ | ✓ | ✓ |
| State Management | ✓ Native | ✗ | ✗ | ✗ |
| Multi-turn Conversations | ✓ Threads | ✓ Threads | ✗ | ✗ |
| System Folders | ✓ `.claude`, `.codex` | ✗ | ✗ | ✗ |
| Agent Protocol | ✓ ACP | ✗ | ✗ | ✗ |
| Cold Start | ~2-5s | ~1-3s | ~5-10s | <1s |
| Best For | Stateful agents | Code execution | Dev environments | Fast resume |

## Testing

### Run Tests
```bash
# Unit tests (mocked)
pnpm test __tests__/sandbox/terminaluse-provider.test.ts

# Live integration (requires API key)
ENABLE_LIVE_TERMINALUSE_TESTS=true pnpm test:terminaluse
```

### Test Coverage
- Provider initialization: ✓
- Client API methods: ✓
- Sandbox operations: ✓
- Task management: ✓
- Event streaming: ✓
- State management: ✓
- Agent service: ✓

## Configuration

### Required
```env
TERMINALUSE_API_KEY=tu_your_api_key_here
```

### Optional
```env
TERMINALUSE_BASE_URL=https://api.terminaluse.com
TERMINALUSE_NAMESPACE=my-namespace
TERMINALUSE_PROJECT_ID=proj_xxxxx
QUOTA_TERMINALUSE_MONTHLY=5000
```

### Provider Chain
```env
SANDBOX_PROVIDER=terminaluse
# or
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,terminaluse,modal-com,mistral-agent,modal
```

## Deployment Checklist

- [ ] Get TerminalUse API key from dashboard
- [ ] Add to `.env.local`
- [ ] Update provider fallback chain
- [ ] Deploy agent via `tu deploy`
- [ ] Create project for filesystems
- [ ] Test task creation
- [ ] Test event streaming
- [ ] Test filesystem persistence
- [ ] Configure quotas and limits
- [ ] Set up monitoring and alerts

## Monitoring

### Metrics to Track
- Task creation rate
- Task completion time
- Filesystem sync duration
- Event streaming latency
- State update frequency
- Error rates by operation

### Logging
```typescript
import { createLogger } from '@/lib/utils/logger'
const logger = createLogger('TerminalUse')

logger.info('Task created', { taskId, agentName })
logger.warn('Task timeout', { taskId, duration })
logger.error('Filesystem sync failed', { error })
```

## Security Considerations

### Authentication
- Bearer token via `TERMINALUSE_API_KEY`
- JWT for API route protection
- Webhook signature verification (for callbacks)

### Authorization
- Project-level permissions for filesystems
- Namespace isolation
- Task-scoped access

### Sandboxing
- Isolated task execution
- Read-only `/workspace` without permission
- System folders task-scoped

## Future Enhancements

### Planned
- [ ] Webhook callback support for async operations
- [ ] Enhanced filesystem sync (manifest-based)
- [ ] Multi-agent orchestration
- [ ] Advanced task routing
- [ ] Custom branch/version management

### Potential
- [ ] GPU-enabled tasks
- [ ] Custom runtime images
- [ ] VPC networking
- [ ] Dedicated environments
- [ ] Audit logging

## Resources

- [TerminalUse Platform](https://app.terminaluse.com)
- [Documentation](https://docs.terminaluse.com/)
- [ADK Reference](https://docs.terminaluse.com/api-reference/adk)
- [CLI Reference](https://docs.terminaluse.com/api-reference/cli)
- [GitHub Examples](https://github.com/terminaluse/examples)

## Support

For issues or questions:
1. Check [troubleshooting guide](./terminaluse-integration.md#troubleshooting)
2. Review [API documentation](https://docs.terminaluse.com/api-reference)
3. Contact TerminalUse support via dashboard
4. File issue in binG repository

---

**Integration Date**: 2026-03-28  
**Version**: 1.0.0  
**Status**: Production Ready
