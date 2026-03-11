# V2 Agent Testing Plan

This document describes the comprehensive testing plan for the V2 agent architecture fixes and features.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Automated Tests](#automated-tests)
4. [Manual Testing](#manual-testing)
5. [Test Scenarios](#test-scenarios)
6. [Expected Results](#expected-results)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The V2 agent architecture has been updated with the following fixes:

1. **Session ID Mismatch Fix** - Removed confusing `sessionId.split(':')` logic
2. **Session Manager Consolidation** - AgentSessionManager now delegates state to OpenCodeV2SessionManager
3. **VFS Sync** - Bidirectional sync before/after execution
4. **Streaming Support** - SSE streaming for real-time responses
5. **MCP Integration** - CLI server for tool discovery
6. **Nullclaw Integration** - External URL support

---

## Prerequisites

### Environment Setup

```bash
# Copy environment template
cp __tests__/v2-agent/.env.test.example .env.test

# Edit .env.test with your configuration
# Required:
V2_AGENT_ENABLED=true
OPENCODE_CONTAINERIZED=true

# Optional (for integration tests):
NULLCLAW_ENABLED=true
NULLCLAW_URL=http://localhost:3001
MCP_ENABLED=true
MCP_CLI_PORT=8888
MCP_CLI_AUTH_TOKEN=your-secure-token
```

### Services Required

1. **Main Application** - Running on `http://localhost:3000`
2. **Docker** - For sandbox containers
3. **Nullclaw** (optional) - Running on `http://localhost:3001`
4. **MCP CLI Server** (optional) - Running on `http://localhost:8888`

### Start Services

```bash
# Start main application
npm run dev

# Start Nullclaw (if enabled)
docker-compose -f docker-compose.v2.yml up -d nullclaw

# Verify MCP CLI server (if enabled)
curl http://localhost:8888/health
```

---

## Automated Tests

### Run Jest Tests

```bash
# Run all V2 agent tests
npm test -- __tests__/v2-agent/v2-integration.test.ts

# Run specific test suite
npm test -- __tests__/v2-agent/v2-integration.test.ts -t "Session Management"

# Run with coverage
npm test -- __tests__/v2-agent/v2-integration.test.ts --coverage
```

### Test Suites

1. **V2 Agent Session Management**
   - Session creation with UUID
   - Session ID resolution (without split(':'))
   - State synchronization between managers

2. **VFS ↔ Sandbox Synchronization**
   - Sync VFS to sandbox
   - Sync sandbox to VFS
   - Filesystem event emission

3. **Nullclaw Integration**
   - Task execution through Nullclaw
   - NULLCLAW_URL environment variable

4. **MCP CLI Server**
   - Server health check
   - Authentication
   - Tool discovery

5. **V2 Streaming Responses**
   - SSE stream format
   - JSON response (non-streaming)

6. **V1 Chat Flow Regression**
   - agentMode: v1
   - agentMode: auto (default)
   - agentMode: v2 routing

7. **Session Manager Consolidation**
   - State consistency
   - Cleanup both sessions

---

## Manual Testing

### Quick Start

```bash
# Make script executable
chmod +x scripts/test-v2-agent.sh

# Run all tests
./scripts/test-v2-agent.sh all

# Run specific test
./scripts/test-v2-agent.sh session
./scripts/test-v2-agent.sh sync
./scripts/test-v2-agent.sh execute
./scripts/test-v2-agent.sh streaming
```

### Step-by-Step Manual Testing

#### 1. Create V2 Session

```bash
curl -X POST http://localhost:3000/api/agent/v2/session \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "test-conv-123",
    "enableNullclaw": false,
    "enableMCP": false
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "v2SessionId": "v2-abc123",
    "workspacePath": "/workspace/users/test-user/sessions/test-conv-123"
  }
}
```

#### 2. Verify Session ID Resolution

```bash
curl http://localhost:3000/api/agent/v2/session?sessionId=550e8400-e29b-41d4-a716-446655440000
```

**Expected:** Session data returned (no 404 error)

#### 3. Write File to VFS

```bash
curl -X POST http://localhost:3000/api/filesystem/write \
  -H "Content-Type: application/json" \
  -d '{
    "path": "project/test.txt",
    "content": "Hello from test",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

#### 4. Sync to Sandbox

```bash
curl -X POST http://localhost:3000/api/agent/v2/sync \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "direction": "to-sandbox"
  }'
```

**Expected:** `filesSynced > 0`

#### 5. Execute Task

```bash
curl -X POST http://localhost:3000/api/agent/v2/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "task": "Append \" - Modified\" to project/test.txt",
    "stream": false
  }'
```

#### 6. Verify VFS Changes

```bash
curl -X POST http://localhost:3000/api/filesystem/read \
  -H "Content-Type: application/json" \
  -d '{"path": "project/test.txt"}'
```

**Expected:** Content includes " - Modified"

#### 7. Test Streaming

```bash
curl -N -X POST http://localhost:3000/api/agent/v2/execute \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "550e8400-e29b-41d4-a716-446655440000",
    "task": "Count from 1 to 5",
    "stream": true
  }'
```

**Expected:** SSE events: `init`, `token`, `done`

#### 8. Check Session Status

```bash
curl http://localhost:3000/api/agent/v2/session/status?sessionId=550e8400-e29b-41d4-a716-446655440000
```

**Expected:** Both `agentState` and `v2State` present with correct mapping

#### 9. Cleanup

```bash
curl -X DELETE http://localhost:3000/api/agent/v2/session?sessionId=550e8400-e29b-41d4-a716-446655440000
```

---

## Test Scenarios

### Scenario 1: Complete V2 Workflow

**Steps:**
1. Create V2 session
2. Write file to VFS
3. Sync to sandbox
4. Execute OpenCode task
5. Sync from sandbox
6. Verify VFS changes
7. Check session status
8. Destroy session

**Expected:** All steps succeed, VFS shows changes

### Scenario 2: Session ID Resolution

**Steps:**
1. Create session (get UUID)
2. Access session with UUID only (no `:` split)
3. Verify session found

**Expected:** Session resolved correctly without split(':') logic

### Scenario 3: State Consistency

**Steps:**
1. Create session
2. Execute task (state → busy/active)
3. Check both AgentSession and OpenCodeV2Session states
4. Verify state mapping

**Expected:** States synchronized (ready→active, busy→active, idle→idle)

### Scenario 4: Nullclaw Integration

**Prerequisites:** NULLCLAW_URL configured

**Steps:**
1. Create session with Nullclaw enabled
2. Execute messaging task
3. Verify HTTP call to NULLCLAW_URL
4. Check response

**Expected:** Task routed to Nullclaw, HTTP response received

### Scenario 5: MCP Tool Discovery

**Prerequisites:** MCP_ENABLED=true, MCP CLI server running

**Steps:**
1. Start MCP CLI server
2. Verify health endpoint
3. Request tools list with auth token
4. Verify tools discovered

**Expected:** Tools list returned with authentication

### Scenario 6: Streaming Response

**Steps:**
1. Execute task with `stream: true`
2. Verify SSE headers
3. Parse events: init, token, done
4. Verify progressive rendering

**Expected:** Real-time streaming with proper SSE format

### Scenario 7: V1 Regression

**Steps:**
1. Call `/api/chat` with `agentMode: 'v1'`
2. Verify V1 flow works
3. Call with no agentMode (auto)
4. Verify default behavior

**Expected:** V1 flow unchanged, auto-detection works

---

## Expected Results

### Success Criteria

| Test | Expected Result |
|------|----------------|
| Session Creation | UUID returned, v2SessionId starts with "v2-" |
| Session ID Resolution | Works with UUID, no split(':') errors |
| VFS Write | File created, workspaceVersion incremented |
| Sync to Sandbox | filesSynced > 0 |
| Execute Task | Task completed, output returned |
| Sync from Sandbox | Changes appear in VFS |
| Streaming | SSE format, events: init/token/done |
| Session Status | Both agentState and v2State present |
| State Mapping | Correct mapping (ready→active, etc.) |
| Cleanup | Both sessions destroyed |
| V1 Regression | V1 flow still works |

### Performance Benchmarks

| Operation | Target | Acceptable |
|-----------|--------|------------|
| Session Creation | < 5s | < 10s |
| VFS Sync | < 2s | < 5s |
| Task Execution | < 30s | < 60s |
| Streaming Start | < 1s | < 2s |

---

## Troubleshooting

### Common Issues

#### 1. Session Not Found (404)

**Symptoms:** API returns 404 when accessing session

**Causes:**
- Session expired (TTL: 30 minutes)
- Session ID format incorrect

**Fix:**
```bash
# Create new session
curl -X POST http://localhost:3000/api/agent/v2/session ...

# Use correct session ID format (UUID)
curl http://localhost:3000/api/agent/v2/session?sessionId=<UUID>
```

#### 2. Sync Fails

**Symptoms:** filesSynced = 0

**Causes:**
- Sandbox not ready
- VFS empty

**Fix:**
```bash
# Check session status
curl http://localhost:3000/api/agent/v2/session/status?sessionId=<UUID>

# Verify VFS has files
curl -X POST http://localhost:3000/api/filesystem/read ...
```

#### 3. Streaming Not Working

**Symptoms:** JSON response instead of SSE

**Causes:**
- `stream: false` in request
- Server configuration issue

**Fix:**
```bash
# Ensure stream: true
curl -X POST ... -d '{"stream": true}'

# Check response headers
curl -v ... | grep Content-Type
# Should be: text/event-stream
```

#### 4. State Mismatch

**Symptoms:** agentState and v2State don't match mapping

**Causes:**
- Race condition during state transition
- Delegation not working

**Fix:**
```bash
# Check logs for delegation errors
docker logs <container> | grep "Failed to update V2 session"

# Wait for state to stabilize
sleep 2
curl http://localhost:3000/api/agent/v2/session/status?sessionId=<UUID>
```

#### 5. Nullclaw Not Responding

**Symptoms:** Nullclaw tasks fail

**Causes:**
- NULLCLAW_URL not configured
- Nullclaw service down

**Fix:**
```bash
# Check NULLCLAW_URL
echo $NULLCLAW_URL

# Test health endpoint
curl $NULLCLAW_URL/health

# Restart Nullclaw
docker-compose restart nullclaw
```

#### 6. MCP Tools Not Discovered

**Symptoms:** Empty tools list

**Causes:**
- MCP CLI server not running
- Auth token mismatch

**Fix:**
```bash
# Check server status
curl http://localhost:8888/health

# Verify auth token
curl -H "Authorization: Bearer $MCP_CLI_AUTH_TOKEN" http://localhost:8888/tools

# Restart MCP server
npm run mcp:start
```

### Debug Mode

Enable debug logging:

```bash
# In .env
DEBUG=Agent:SessionManager,API:AgentV2,V2Executor
LOG_LEVEL=debug

# View logs
docker logs -f <app-container> | grep -E "(Agent:SessionManager|API:AgentV2|V2Executor)"
```

### Contact

For issues not covered here, check:
- GitHub Issues: [link to repo issues]
- Documentation: [link to docs]
- Slack: #v2-agent-testing
