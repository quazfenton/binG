# Quick Reference Guide

## 🚀 Quick Start

### 1. Install & Configure

```bash
# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### 2. Run

```bash
# Standard mode (SSE fallback)
pnpm dev

# With WebSocket support
pnpm dev:ws
```

### 3. Use

```typescript
import { createQuickAgent } from '@/lib/agent/unified-agent'

const agent = await createQuickAgent({
  provider: 'e2b',
  desktop: true,
})

await agent.terminalSend('ls -la')
await agent.cleanup()
```

---

## 📦 Unified Agent API

### Create Agent

```typescript
// Quick setup
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
    browserbase: { apiKey: '...' },
  },
  desktop: { enabled: true, resolution: { width: 1920, height: 1080 } },
})
```

### Terminal

```typescript
// Send input
await agent.terminalSend('ls -la')

// Get output
const output = agent.getTerminalOutput()

// Listen for output
agent.onTerminalOutput((out) => console.log(out.data))
```

### Desktop (Computer Use)

```typescript
// Screenshot
const screenshot = await agent.desktopScreenshot()
const resolution = await agent.desktopResolution()

// Mouse
await agent.desktopClick({ x: 100, y: 200 })
await agent.desktopMove({ x: 150, y: 250 })
await agent.desktopHotkey(['Control', 'C'])

// Keyboard
await agent.desktopType('Hello')
await agent.desktopPress('Enter')
```

### MCP

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
const result = await agent.codeExecute('python', `
import pandas as pd
df = pd.DataFrame({'a': [1, 2, 3]})
print(df.mean())
`)

console.log(result.output)
```

### Git

```typescript
await agent.gitClone('https://github.com/owner/repo.git', {
  path: 'my-repo',
  depth: 1,
})

await agent.gitCommit('feat: add feature', true)
await agent.gitPush('origin', 'main')
```

### Files

```typescript
const content = await agent.readFile('src/index.ts')
await agent.writeFile('src/new.ts', 'export const x = 1')
```

### Session

```typescript
const session = agent.getSession()
const stats = agent.getSessionStats()
await agent.cleanup()
```

---

## ⚛️ React Hook

### Basic Usage

```tsx
import { useAgent } from '@/lib/agent/use-agent'

function MyComponent() {
  const {
    connected,
    output,
    send,
    clearOutput,
    disconnect,
  } = useAgent({
    provider: 'e2b',
    capabilities: ['terminal'],
  })

  return (
    <div>
      <div>Status: {connected ? 'Connected' : 'Disconnected'}</div>
      <button onClick={() => send('ls -la\n')}>List Files</button>
      <button onClick={clearOutput}>Clear</button>
      <button onClick={disconnect}>Disconnect</button>
      <pre>{output.map(o => o.data).join('')}</pre>
    </div>
  )
}
```

### Desktop Agent

```tsx
import { useDesktopAgent } from '@/lib/agent/use-agent'

function DesktopComponent() {
  const {
    connected,
    screenshot,
    captureScreenshot,
  } = useDesktopAgent({
    provider: 'e2b',
    resolution: { width: 1920, height: 1080 },
  })

  return (
    <div>
      {screenshot && (
        <img src={`data:image/png;base64,${screenshot}`} alt="Desktop" />
      )}
      <button onClick={captureScreenshot}>Screenshot</button>
    </div>
  )
}
```

### Terminal Agent

```tsx
import { useTerminalAgent } from '@/lib/agent/use-agent'

function TerminalComponent() {
  const {
    connected,
    output,
    send,
  } = useTerminalAgent({
    provider: 'e2b',
    maxOutputLength: 500,
  })

  return (
    <div>
      {output.map((o, i) => (
        <div key={i}>{o.data}</div>
      ))}
      <input onKeyDown={(e) => send(e.key === 'Enter' ? e.currentTarget.value + '\n' : '')} />
    </div>
  )
}
```

---

## 🧩 React Components

### AgentTerminal

```tsx
import { AgentTerminal } from '@/components/agent/AgentTerminal'

function App() {
  return (
    <AgentTerminal
      provider="e2b"
      capabilities={['terminal', 'desktop']}
      height="500px"
      theme="dark"
      showStatus
      showToolbar
      commandInput
      onConnect={(session) => console.log('Connected:', session)}
    />
  )
}
```

### AgentDesktop

```tsx
import { AgentDesktop } from '@/components/agent/AgentTerminal'

function App() {
  return (
    <AgentDesktop
      provider="e2b"
      resolution={{ width: 1920, height: 1080 }}
      showControls
    />
  )
}
```

---

## 🔧 WebSocket Commands

### Client → Server

```json
{ "type": "input", "data": "ls -la\n" }
{ "type": "resize", "cols": 80, "rows": 24 }
{ "type": "ping" }
```

### Server → Client

```json
{ "type": "connected", "data": { "sessionId": "...", "sandboxId": "..." } }
{ "type": "pty", "data": "total 48\n" }
{ "type": "port_detected", "data": { "port": 3000, "url": "..." } }
{ "type": "error", "data": "Error message" }
{ "type": "ping" }
```

---

## 🛠️ Commands

```bash
# Development
pnpm dev           # Standard mode
pnpm dev:ws        # With WebSocket

# Production
pnpm start         # Standard mode
pnpm start:ws      # With WebSocket

# Testing
pnpm test
pnpm test:watch
pnpm test:e2e
```

---

## 📁 File Structure

```
lib/
  agent/
    unified-agent.ts       # Core agent
    use-agent.ts           # React hook
    index.ts               # Exports
  sandbox/
    enhanced-terminal-manager.ts
    enhanced-sandbox-tools.ts
  terminal/
    terminal-manager.ts
    terminal-security.ts
    terminal-storage.ts

components/
  terminal/
    TerminalPanel.tsx      # Main terminal UI
  agent/
    AgentTerminal.tsx      # Agent terminal component

app/api/sandbox/terminal/
  ws/route.ts              # WebSocket endpoint
  stream/route.ts          # SSE endpoint
  input/route.ts           # Input endpoint
  resize/route.ts          # Resize endpoint

server.ts                  # Custom WebSocket server
```

---

## 🔑 Environment Variables

```bash
# Required
E2B_API_KEY=your_e2b_key
DAYTONA_API_KEY=your_daytona_key

# Optional
BROWSERBASE_API_KEY=your_browserbase_key
BROWSERBASE_PROJECT_ID=your_project_id

# WebSocket
WEBSOCKET_PROTOCOL=wss
WEBSOCKET_HOST=your-domain.com

# Provider
SANDBOX_PROVIDER=daytona
SANDBOX_FALLBACK_PROVIDER=e2b
SANDBOX_ENABLE_FALLBACK=true
```

---

## 📊 Provider Comparison

| Provider | Best For | Features |
|----------|----------|----------|
| E2B | Code execution | Jupyter, PTY, Desktop, MCP |
| Daytona | Computer use | Computer Use, Recording, SSH |
| Blaxel | Async agents | Triggers, Callbacks, Jobs |
| Sprites | File sync | Tar-pipe sync, SSHFS |
| CodeSandbox | Dev envs | VSCode, Previews |

---

## ⚡ Performance Tips

1. **Use WebSocket** for lower latency (~5ms vs ~50ms)
2. **Batch inputs** with 50ms debounce for SSE
3. **Limit output** with `maxOutputLength` in React
4. **Auto-resume** sessions to avoid reconnection overhead
5. **Clean up** with `agent.cleanup()` when done

---

## 🔒 Security

1. **Validate commands** before execution
2. **Use tokens** for WebSocket auth (5-min TTL, single-use)
3. **Session validation** for sandbox access
4. **Input sanitization** for all user input

---

## 📚 Full Documentation

- [Terminal WebSocket Implementation](./TERMINAL_WEBSOCKET_IMPLEMENTATION.md)
- [Advanced Agent Integration](./ADVANCED_AGENT_INTEGRATION.md)
- [Complete Implementation Summary](../COMPLETE_IMPLEMENTATION_SUMMARY.md)
- [Examples](../examples/unified-agent-examples.ts)

---

## 🆘 Troubleshooting

### WebSocket not connecting
```bash
# Check if custom server is running
pnpm dev:ws

# Verify environment
echo $WEBSOCKET_HOST
```

### Desktop not working
```bash
# Check E2B API key
echo $E2B_API_KEY

# Verify @e2b/desktop is installed
pnpm list @e2b/desktop
```

### MCP tools not available
```bash
# Check MCP configuration
# Ensure API keys are set in .env
```

### Quota exceeded
```bash
# Switch to fallback provider
# Set SANDBOX_ENABLE_FALLBACK=true
```
