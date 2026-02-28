# Advanced Agent Integration Guide

## Overview

This guide covers advanced integrations and enhancements for the binG0 sandbox and terminal system, including:

- WebSocket bidirectional streaming
- Computer use agents (desktop automation)
- MCP (Model Context Protocol) integration
- Enhanced code execution
- Git operations with authentication
- Multi-provider fallback support
- **Unified Agent Interface** - Single API for all capabilities

## Table of Contents

1. [WebSocket Terminal](#websocket-terminal)
2. [Computer Use Agents](#computer-use-agents)
3. [MCP Integration](#mcp-integration)
4. [Enhanced Code Execution](#enhanced-code-execution)
5. [Git Operations](#git-operations)
6. [Multi-Provider Support](#multi-provider-support)
7. [Unified Agent Interface](#unified-agent-interface)
8. [Best Practices](#best-practices)

---

## WebSocket Terminal

### Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   Terminal UI   │◄───────►│  WebSocket Server│◄───────►│  Sandbox Provider│
│  (TerminalPanel)│         │   (server.ts)    │         │  (E2B/Daytona)  │
└─────────────────┘         └──────────────────┘         └─────────────────┘
       │                           │                            │
       │ 1. Attempt WebSocket      │                            │
       ├──────────────────────────►│                            │
       │                           │ 2. Upgrade Connection      │
       │                           ├───────────────────────────►│
       │                           │                            │
       │ 3. Bidirectional Stream   │                            │
       │◄──────────────────────────┤                            │
       │                           │ 4. PTY Output              │
       │                           ├────────────────────────────┤
       │                           │                            │
       │ 5. Input (WebSocket)      │                            │
       ├──────────────────────────►│                            │
       │                           │ 6. Forward to PTY          │
       │                           ├───────────────────────────►│
└─────────────────┘         └──────────────────┘         └─────────────────┘
```

### Usage

```typescript
// Frontend: TerminalPanel automatically uses WebSocket when available
// No code changes needed - automatic fallback to SSE

// Backend: Custom server for WebSocket support
// server.ts is already configured

// Start with WebSocket
pnpm dev:ws    # Development
pnpm start:ws  # Production
```

### Configuration

```bash
# .env
WEBSOCKET_PROTOCOL=wss
WEBSOCKET_HOST=your-domain.com
```

### Message Format

**Client → Server:**
```json
{ "type": "input", "data": "ls -la\n" }
{ "type": "resize", "cols": 80, "rows": 24 }
{ "type": "ping" }
```

**Server → Client:**
```json
{ "type": "pty", "data": "total 48\n" }
{ "type": "connected", "data": { "sessionId": "sess_123", "sandboxId": "sbx_456" } }
{ "type": "port_detected", "data": { "port": 3000, "url": "https://preview.example.com" } }
```

---

## Computer Use Agents

### Overview

Computer use agents can interact with a virtual desktop environment using mouse and keyboard operations. Supported by:

- **E2B Desktop**: Full Linux desktop with VNC access
- **Daytona Computer Use**: Screen control with recording capabilities

### E2B Desktop Integration

```typescript
import { Sandbox } from '@e2b/code-interpreter'

// Create sandbox with desktop
const sandbox = await Sandbox.create({
  template: 'desktop',
  envs: {
    E2B_API_KEY: process.env.E2B_API_KEY,
  },
})

// Get desktop handle
const desktop = await sandbox.desktop.create()

// Take screenshot
const screenshot = await desktop.screenshot()

// Mouse operations
await desktop.mouse.click({ x: 100, y: 200 })
await desktop.mouse.move({ x: 150, y: 250 })
await desktop.mouse.drag({ from: { x: 100, y: 100 }, to: { x: 200, y: 200 } })

// Keyboard operations
await desktop.keyboard.type('Hello, World!')
await desktop.keyboard.press('Enter')
await desktop.keyboard.hotkey(['Control', 'C'])

// Get window list
const windows = await desktop.windows.list()
```

### Daytona Computer Use

```typescript
import { Daytona } from '@daytonaio/sdk'

const client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
const sandbox = await client.create({ image: 'python' })

// Get computer use service
const computerUse = sandbox.getComputerUseService()

// Start computer use session
await computerUse.start()

// Take screenshot
const screenshot = await computerUse.screenshot.takeFullScreen()

// Mouse operations
await computerUse.mouse.click({ x: 100, y: 200, button: 'left' })
await computerUse.mouse.move({ x: 150, y: 250 })
await computerUse.mouse.scroll({ deltaX: 0, deltaY: 100 })

// Keyboard operations
await computerUse.keyboard.type({ text: 'Hello' })
await computerUse.keyboard.press({ key: 'Enter' })
await computerUse.keyboard.hotkey({ keys: ['Control', 'A'] })

// Screen recording
await computerUse.recording.start({ outputDir: '/recordings' })
// ... perform actions ...
const recordings = await computerUse.recording.list()
await computerUse.recording.stop()

// Stop computer use
await computerUse.stop()
```

### Integration with Terminal

```typescript
// In your agent loop
import { enhancedTerminalManager } from '@/lib/sandbox/enhanced-terminal-manager'

// Create terminal with desktop support
const sessionId = await enhancedTerminalManager.createTerminalSessionWithDesktop(
  'session-123',
  'sandbox-456',
  (data) => console.log('Terminal output:', data),
  (preview) => console.log('Preview:', preview),
  { enableDesktop: true }
)

// Get desktop handle
const desktop = enhancedTerminalManager.getDesktop('session-123')

// Use desktop in agent loop
async function agentLoop() {
  const observation = await desktop.screenshot()
  const action = await llm.decide(observation)
  
  if (action.type === 'click') {
    await desktop.mouse.click(action.coords)
  } else if (action.type === 'type') {
    await desktop.keyboard.type(action.text)
  }
}
```

---

## MCP Integration

### Overview

MCP (Model Context Protocol) provides access to 200+ tools through a unified interface. Tools are available via:

- **E2B MCP Gateway**: Built-in gateway for E2B sandboxes
- **Blaxel MCP Servers**: Deploy MCP servers on Blaxel
- **Custom MCP Servers**: Run your own MCP servers

### E2B MCP Gateway

```typescript
import { Sandbox } from '@e2b/code-interpreter'

const sandbox = await Sandbox.create({
  template: 'base',
  mcp: {
    // Pre-configured MCP servers
    browserbase: {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    },
    filesystem: {
      rootPath: '/workspace',
    },
  },
})

// Get MCP gateway URL and token
const mcpUrl = sandbox.getMcpUrl()
const mcpToken = await sandbox.getMcpToken()

// Add MCP to Claude Code
await sandbox.commands.run(
  `claude mcp add --transport http e2b-mcp-gateway ${mcpUrl} --header "Authorization: Bearer ${mcpToken}"`
)

// Use MCP tools in agent
const result = await sandbox.commands.run(
  `claude --dangerously-skip-permissions -p "Use browserbase to research E2B"`
)
```

### Custom MCP Server

```typescript
// mcp-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio'

const server = new McpServer({
  name: 'my-mcp-server',
  version: '1.0.0',
})

// Register tools
server.tool('search_web', 'Search the web', {
  query: { type: 'string', description: 'Search query' },
}, async ({ query }) => {
  const results = await search(query)
  return {
    content: [{ type: 'text', text: JSON.stringify(results) }],
  }
})

// Start server
const transport = new StdioServerTransport()
await server.connect(transport)
```

### MCP Tool Calling in Agent

```typescript
import { enhancedTerminalManager } from '@/lib/sandbox/enhanced-terminal-manager'

// Get MCP gateway
const mcpGateway = enhancedTerminalManager.getMcpGateway('session-123')

// List available tools
const tools = await mcpGateway.listTools()
console.log('Available tools:', tools)

// Call a tool
const result = await mcpGateway.callTool('search_web', {
  query: 'latest AI news',
})

console.log('Tool result:', result)
```

---

## Enhanced Code Execution

### Code Interpreter (E2B)

```typescript
import { Sandbox } from '@e2b/code-interpreter'

const sandbox = await Sandbox.create()

// Run Python code
const result = await sandbox.runCode(`
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.plot(x, y)
plt.title('Sine Wave')
plt.show()
`)

console.log('Output:', result.text)
console.log('Charts:', result.charts) // Base64 encoded charts
console.log('Files:', result.files)   // Generated files
```

### Multi-Language Support

```typescript
// Using enhanced sandbox tools
import { getToolByName } from '@/lib/sandbox/enhanced-sandbox-tools'

const runCodeTool = getToolByName('run_code')

// Python
const pythonResult = await runCodeTool.execute({
  code: 'print("Hello from Python!")',
  language: 'python',
})

// JavaScript
const jsResult = await runCodeTool.execute({
  code: 'console.log("Hello from JavaScript!")',
  language: 'javascript',
})

// Go
const goResult = await runCodeTool.execute({
  code: `
package main
import "fmt"
func main() {
  fmt.Println("Hello from Go!")
}`,
  language: 'go',
})
```

### Streaming Output

```typescript
const sandbox = await Sandbox.create()

// Stream command output
const result = await sandbox.commands.run(
  'pip install pandas',
  {
    onStdout: (data) => process.stdout.write(`[STDOUT] ${data}`),
    onStderr: (data) => process.stderr.write(`[STDERR] ${data}`),
  }
)

console.log('Exit code:', result.exitCode)
```

---

## Git Operations

### Clone Repository

```typescript
import { Sandbox } from '@e2b/code-interpreter'

const sandbox = await Sandbox.create()

// Public repository
await sandbox.git.clone('https://github.com/owner/repo.git', {
  path: '/workspace/repo',
  depth: 1, // Shallow clone
})

// Private repository with authentication
await sandbox.git.clone('https://github.com/owner/private-repo.git', {
  path: '/workspace/private-repo',
  username: 'x-access-token', // GitHub Apps
  password: process.env.GITHUB_TOKEN,
  depth: 1,
})
```

### Git Workflow

```typescript
// Make changes
await sandbox.files.write('/workspace/repo/src/index.ts', `
export function hello() {
  console.log('Hello, World!')
}
`)

// Check status
const status = await sandbox.commands.run('cd /workspace/repo && git status')
console.log('Status:', status.stdout)

// Stage and commit
await sandbox.commands.run('cd /workspace/repo && git add .')
await sandbox.commands.run('cd /workspace/repo && git commit -m "Add hello function"')

// Push changes
await sandbox.commands.run('cd /workspace/repo && git push origin main')
```

### Enhanced Git Tools

```typescript
import { getToolsByCategory } from '@/lib/sandbox/enhanced-sandbox-tools'

const gitTools = getToolsByCategory('git')

// Clone
await gitTools.find(t => t.name === 'git_clone')?.execute({
  url: 'https://github.com/owner/repo.git',
  path: 'my-repo',
  branch: 'develop',
})

// Commit
await gitTools.find(t => t.name === 'git_commit')?.execute({
  message: 'feat: add new feature',
  all: true,
})

// Push
await gitTools.find(t => t.name === 'git_push')?.execute({
  remote: 'origin',
  branch: 'main',
})
```

---

## Multi-Provider Support

### Provider Configuration

```bash
# .env
# Primary provider
SANDBOX_PROVIDER=daytona

# Fallback provider (when primary is unavailable)
SANDBOX_FALLBACK_PROVIDER=e2b
SANDBOX_ENABLE_FALLBACK=true

# Provider-specific settings
E2B_API_KEY=xxx
DAYTONA_API_KEY=xxx
BLAXEL_API_KEY=xxx
SPRITES_API_KEY=xxx
```

### Automatic Provider Selection

```typescript
import { getSandboxProvider } from '@/lib/sandbox/providers'

// Provider is automatically selected based on:
// 1. Sandbox ID prefix (e.g., 'e2b-xxx' → E2B)
// 2. Primary provider configuration
// 3. Fallback provider if primary fails

// Example: Create sandbox with automatic fallback
const provider = getSandboxProvider() // Uses configured provider
const handle = await provider.createSandbox({
  language: 'typescript',
  timeout: 300000,
})

// If primary fails, automatically tries fallback
```

### Provider Comparison

| Provider | Best For | Features | Pricing |
|----------|----------|----------|---------|
| E2B | Code execution, Desktop | Jupyter, PTY, Desktop, MCP | Pay per session |
| Daytona | Computer use, CI/CD | Computer Use, Recording, SSH | Pay per minute |
| Blaxel | Async agents | Triggers, Callbacks, Jobs | Pay per execution |
| Sprites | File sync | Tar-pipe sync, SSHFS | Pay per GB |
| CodeSandbox | Dev environments | VSCode, Previews | Pay per hour |

---

## Best Practices

### 1. Connection Management

```typescript
// Always clean up connections
useEffect(() => {
  return () => {
    terminal.websocket?.close()
    terminal.eventSource?.close()
  }
}, [])

// Handle reconnection
const reconnect = async () => {
  try {
    await enhancedTerminalManager.autoResumeSession(sessionId, sandboxId, onData)
  } catch (error) {
    console.error('Reconnection failed:', error)
    // Fall back to new session
  }
}
```

### 2. Error Handling

```typescript
try {
  const result = await sandbox.commands.run(command)
} catch (error) {
  if (error.message.includes('quota')) {
    // Switch to fallback provider
    const fallbackProvider = getSandboxProvider('e2b')
    // ...
  } else if (error.message.includes('timeout')) {
    // Increase timeout or retry
    // ...
  }
}
```

### 3. Security

```typescript
// Validate all commands
import { validateCommand } from '@/lib/sandbox/security'

const validation = validateCommand(userCommand)
if (!validation.valid) {
  throw new Error(`Blocked: ${validation.reason}`)
}

// Use tokens for WebSocket authentication
const ws = new WebSocket(`${wsUrl}?token=${connectionToken}`)
```

### 4. Performance

```typescript
// Batch inputs for SSE fallback
const sendInput = useCallback(async (sessionId: string, data: string) => {
  if (websocket) {
    websocket.send(JSON.stringify({ type: 'input', data }))
    return
  }
  
  // Batch with 50ms debounce
  inputBatchRef.current[sessionId] += data
  setTimeout(async () => {
    await fetch('/api/sandbox/terminal/input', {
      body: JSON.stringify({ sessionId, data: inputBatchRef.current[sessionId] }),
    })
    inputBatchRef.current[sessionId] = ''
  }, 50)
}, [])
```

### 5. Resource Management

```typescript
// Auto-stop sandboxes after inactivity
const sandbox = await Sandbox.create({
  timeout: 300000, // 5 minutes
})

// Monitor resource usage
const monitor = setInterval(async () => {
  const usage = await sandbox.getUsage()
  if (usage.cpu > 90 || usage.memory > 90) {
    console.warn('High resource usage:', usage)
  }
}, 60000)
```

---

## Unified Agent Interface

The Unified Agent Interface provides a single, consistent API for all agent capabilities.

### Quick Start

```typescript
import { createAgent, createQuickAgent } from '@/lib/agent/unified-agent'

// Quick setup with defaults
const agent = await createQuickAgent({
  provider: 'e2b',
  desktop: true,
  mcp: true,
})

// Full configuration
const agent = await createAgent({
  provider: 'e2b',
  capabilities: ['terminal', 'desktop', 'mcp', 'code-execution', 'git'],
  mcp: {
    browserbase: { apiKey: process.env.BROWSERBASE_API_KEY },
  },
  desktop: {
    enabled: true,
    resolution: { width: 1920, height: 1080 },
  },
})
```

### Terminal Operations

```typescript
// Send input
await agent.terminalSend('ls -la')

// Get output history
const output = agent.getTerminalOutput()

// Listen for real-time output
agent.onTerminalOutput((output) => {
  console.log(`[${output.type}] ${output.data}`)
})
```

### Desktop Operations (Computer Use)

```typescript
// Screenshot
const screenshot = await agent.desktopScreenshot()
const resolution = await agent.desktopResolution()

// Mouse
await agent.desktopClick({ x: 100, y: 200 })
await agent.desktopMove({ x: 150, y: 250 })
await agent.desktopHotkey(['Control', 'C'])

// Keyboard
await agent.desktopType('Hello, World!')
await agent.desktopPress('Enter')
```

### MCP Operations

```typescript
// List tools
const tools = await agent.mcpListTools()

// Call tool
const result = await agent.mcpCall('browserbase_navigate', {
  url: 'https://example.com',
})
```

### Code Execution

```typescript
// Python
const result = await agent.codeExecute('python', `
import pandas as pd
df = pd.DataFrame({'a': [1, 2, 3]})
print(df.mean())
`)

console.log('Output:', result.output)
console.log('Execution time:', result.executionTime)
```

### Git Operations

```typescript
// Clone
await agent.gitClone('https://github.com/owner/repo.git', {
  path: 'my-repo',
  depth: 1,
})

// Commit
await agent.gitCommit('feat: add new feature', true)

// Push
await agent.gitPush('origin', 'main')
```

### File Operations

```typescript
// Read
const content = await agent.readFile('src/index.ts')

// Write
await agent.writeFile('src/new.ts', 'export const value = 42')
```

### Session Management

```typescript
// Get session info
const session = agent.getSession()
console.log('Session:', session)

// Get stats
const stats = agent.getSessionStats()
console.log('Uptime:', stats.uptime)
console.log('Desktop enabled:', stats.desktopEnabled)
console.log('MCP enabled:', stats.mcpEnabled)

// Cleanup
await agent.cleanup()
```

### Complete Example

```typescript
import { createAgent } from '@/lib/agent/unified-agent'

async function developmentWorkflow() {
  const agent = await createAgent({
    provider: 'e2b',
    capabilities: ['terminal', 'git', 'code-execution'],
  })

  try {
    // Clone repository
    await agent.gitClone('https://github.com/owner/project.git')
    
    // Run tests
    await agent.terminalSend('npm test')
    
    // Make changes
    await agent.writeFile('src/feature.ts', `
      export function newFeature() {
        return 'Hello!'
      }
    `)
    
    // Commit and push
    await agent.gitCommit('feat: add new feature', true)
    await agent.gitPush()
    
    console.log('Workflow complete!')
  } finally {
    await agent.cleanup()
  }
}
```

### Error Handling

```typescript
const agent = await createQuickAgent({ provider: 'e2b' })

try {
  await agent.terminalSend('some-command')
} catch (error: any) {
  console.error('Command failed:', error.message)
  
  // Attempt recovery
  await agent.terminalSend('fallback-command')
} finally {
  await agent.cleanup()
}
```

### Examples

See `examples/unified-agent-examples.ts` for complete examples:

- `basicTerminalAgent` - Simple terminal operations
- `computerUseAgent` - Desktop automation
- `mcpAgent` - MCP tool integration
- `gitWorkflowAgent` - Git workflow automation
- `codeExecutionAgent` - Multi-language code execution
- `fullWorkflowAgent` - Complete development cycle
- `agentWithCallbacks` - Real-time output monitoring
- `resilientAgent` - Error handling and recovery

## Related Documentation

- [Terminal WebSocket Implementation](./TERMINAL_WEBSOCKET_IMPLEMENTATION.md)
- [E2B SDK Reference](./sdk/e2b-llms-full.txt)
- [Daytona SDK Reference](./sdk/daytona-llms.txt)
- [Blaxel SDK Reference](./sdk/blaxel-llms-full.txt)

## Example Projects

- [Computer Use Agent](https://github.com/e2b-dev/e2b-cookbook/tree/main/agents/computer-use)
- [MCP Integration Example](https://github.com/e2b-dev/e2b-cookbook/tree/main/mcp)
- [Code Interpreter Demo](https://github.com/e2b-dev/e2b-cookbook/tree/main/code-interpreter)
