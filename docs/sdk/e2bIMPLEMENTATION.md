# E2B Sandbox Provider Implementation

## Overview

This document describes the E2B sandbox provider implementation for the binG project, based on the official E2B documentation and examples.

## Key Changes from Initial Implementation

After reviewing the official E2B examples in `docs/sdk/e2b/`, the following corrections were made:

### 1. PTY API (Most Significant Change)

**Initial (Incorrect):**
```typescript
// Wrong: Using commands.run() for PTY
const cmdHandle = await sandbox.commands.run('/bin/bash', { ... })
```

**Corrected:**
```typescript
// Correct: Using sandbox.pty.create() for interactive terminal
const ptyHandle = await sandbox.pty.create({
  cols: 80,
  rows: 24,
  onData: (data: Uint8Array) => process.stdout.write(data),
  envs: { TERM: 'xterm-256color' },
  cwd: '/home/user',
  timeoutMs: 0, // Disable timeout for long-running sessions
})

// ptyHandle.pid contains the process ID
console.log('Terminal PID:', ptyHandle.pid)
```

### 2. PTY Identification

**Initial:** Used `sessionId: string`
**Corrected:** Uses `pid: number` (process ID returned by E2B)

### 3. PTY Input

**Correct implementation:**
```typescript
// Send input as bytes with newline
await sandbox.pty.sendInput(
  pid,
  new TextEncoder().encode('echo "Hello"\n')
)
```

### 4. PTY Reconnection

E2B supports disconnecting and reconnecting to PTY sessions:

```typescript
// Disconnect (PTY keeps running)
await terminal.disconnect()

// Reconnect later with new handler
const reconnected = await sandbox.pty.connect(pid, {
  onData: (data) => console.log('Handler 2:', data),
})

// Wait for exit
const result = await reconnected.wait()
console.log('Exit code:', result.exitCode)
```

### 5. Code Interpreter

E2B's special feature for Jupyter notebook-style code execution:

```typescript
// Execute Python code with stateful interpreter
const execution = await sandbox.runCode('x = 1')
const result = await sandbox.runCode('x += 1; x')
console.log(result.text) // outputs: 2

// Access execution details
console.log(result.logs.stdout)
console.log(result.logs.stderr)
console.log(result.results) // Jupyter output objects
console.log(result.error)   // Python exceptions
```

## API Reference

### Sandbox Creation

```typescript
import { Sandbox } from '@e2b/code-interpreter'

const sandbox = await Sandbox.create({
  template: 'base',  // or 'go', 'rust', 'java', 'r', 'cpp'
  timeout: 300000,   // 5 minutes in ms
  metadata: { sessionID: 'my-session' },
  envVars: { MY_VAR: 'value' },
})
```

### Commands

```typescript
// Simple command execution
const result = await sandbox.commands.run('npm install', {
  cwd: '/home/user',
  timeout: 60000,
})

// Streaming command
const handle = await sandbox.commands.run('npm install', {
  onStdout: (data) => console.log(data),
  onStderr: (data) => console.error(data),
})
```

### Filesystem

```typescript
// Write file
await sandbox.files.write('/app/test.txt', 'Hello World')

// Read file
const content = await sandbox.files.read('/app/test.txt')

// Watch directory
const watcher = await sandbox.files.watch('/app', {
  callback: (event) => {
    console.log(`File ${event.type}: ${event.path}`)
  }
})
```

### PTY/Terminal

```typescript
// Create interactive terminal
const terminal = await sandbox.pty.create({
  cols: 80,
  rows: 24,
  onData: (data) => process.stdout.write(data),
  envs: { TERM: 'xterm-256color' },
  cwd: '/home/user',
  timeoutMs: 0, // No timeout
})

// Send command (don't forget newline!)
await sandbox.pty.sendInput(
  terminal.pid,
  new TextEncoder().encode('ls -la\n')
)

// Resize terminal
await sandbox.pty.resize(terminal.pid, { cols: 120, rows: 40 })

// Wait for exit
const result = await terminal.wait()
console.log('Exit code:', result.exitCode)

// Kill PTY
await sandbox.pty.kill(terminal.pid)
```

### Session Management

```typescript
// List active sandboxes
const sandboxes = await Sandbox.list()
const sessionSandbox = sandboxes.find(
  sbx => sbx.metadata?.sessionID === 'my-session'
)

// Reconnect to existing sandbox
if (sessionSandbox) {
  const sandbox = await Sandbox.connect(sessionSandbox.sandboxId)
  await sandbox.setTimeout(600000) // 10 minutes
}

// Create new sandbox with session metadata
const sandbox = await Sandbox.create({
  metadata: { sessionID: 'my-session' },
  timeoutMs: 600000,
})

// Kill sandbox
await sandbox.kill()
```

## Environment Variables

```bash
# E2B API Key (required)
E2B_API_KEY=e2b_your_api_key_here

# Default template
E2B_DEFAULT_TEMPLATE=base

# Default timeout (ms)
E2B_DEFAULT_TIMEOUT=300000

# Monthly quota (sandbox sessions)
QUOTA_E2B_MONTHLY=1000
```

## Provider Chain

E2B is integrated into the sandbox provider fallback chain:

```
daytona → runloop → microsandbox → e2b
```

When E2B quota is exceeded, the system automatically falls back to other providers.

## Files Modified

1. **`lib/sandbox/providers/e2b-provider.ts`** - Main E2B provider implementation
2. **`lib/sandbox/providers/sandbox-provider.ts`** - Updated interfaces for PTY (pid instead of sessionId)
3. **`lib/sandbox/providers/daytona-provider.ts`** - Updated to match new PTY interface
4. **`lib/sandbox/providers/index.ts`** - Added E2B provider export
5. **`lib/services/quota-manager.ts`** - Added E2B quota tracking
6. **`lib/database/migrations/003_quota_tracking.sql`** - Added E2B to default quotas
7. **`env.example`** - Added E2B configuration

## Usage Example

```typescript
import { e2bProvider } from '@/lib/sandbox/providers/e2b-provider'

// Create sandbox
const handle = await e2bProvider.createSandbox({
  language: 'python',
  autoStopInterval: 60,
})

// Execute Python code via Jupyter
const codeResult = await handle.runCode('print("Hello from Jupyter!")')
console.log(codeResult.text)

// Create interactive terminal
const pty = await handle.createPty({
  onData: (data) => console.log(data.toString()),
  cols: 80,
  rows: 24,
})

// Send commands
await pty.sendInput('python3\n')  // Start Python REPL
await pty.sendInput('print("Hello")\n')
await pty.sendInput('exit()\n')   // Exit Python
await pty.sendInput('exit\n')     // Exit bash

// Cleanup
await e2bProvider.destroySandbox(handle.id)
```

## References

- [E2B Documentation](https://e2b.dev/docs)
- [E2B Cookbook](https://github.com/e2b-dev/e2b-cookbook)
- [Code Interpreter SDK](https://www.npmjs.com/package/@e2b/code-interpreter)
- [Desktop SDK (Computer Use)](https://www.npmjs.com/package/@e2b/desktop)
