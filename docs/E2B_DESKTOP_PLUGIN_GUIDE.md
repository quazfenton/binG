# E2B Desktop Plugin - Complete Guide

**Date**: 2026-02-27  
**Status**: ✅ **IMPLEMENTED**

---

## Overview

The E2B Desktop Plugin provides **computer use capabilities** for AI agents to interact with graphical desktop environments. It includes:

- 🖥️ **Live VNC desktop streaming** in browser
- 🤖 **Computer use agent loop** with LLM integration
- 🖱️ **Complete mouse control** (move, click, drag, scroll)
- ⌨️ **Complete keyboard control** (type, press, hotkeys)
- 📸 **Screenshot capture** with multiple formats
- 💻 **Terminal command execution**
- 📊 **Action history and statistics**
- 🧹 **Auto-cleanup and lifecycle management**

---

## Installation

```bash
# Install E2B Desktop SDK
pnpm add @e2b/desktop

# Set environment variable
echo "E2B_API_KEY=e2b_your_api_key_here" >> .env.local
```

Get your API key from: https://e2b.dev/dashboard

---

## Quick Start

### 1. Use the Plugin UI

```typescript
// In your interaction panel or page
import E2BDesktopPlugin from '@/components/plugins/e2b-desktop-plugin'

export default function Page() {
  return (
    <E2BDesktopPlugin
      isVisible={true}
      onClose={() => console.log('Closed')}
    />
  )
}
```

### 2. Programmatic Usage

```typescript
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider-enhanced'

// Create desktop sandbox
const desktop = await e2bDesktopProvider.createDesktop({
  resolution: [1024, 720],
  dpi: 96,
  timeoutMs: 300000,
  startStreaming: true,
})

console.log('View desktop at:', desktop.getStreamUrl())

// Take screenshot
const screenshot = await desktop.screenshot()
console.log('Screenshot size:', screenshot.length, 'bytes')

// Mouse actions
await desktop.moveMouse(500, 300)
await desktop.leftClick()
await desktop.type('Hello, Desktop!')

// Keyboard actions
await desktop.press('Enter')
await desktop.hotkey('Control_L', 'c') // Ctrl+C

// Cleanup
await desktop.kill()
```

---

## Plugin UI Features

### Desktop Tab
- **Live VNC Stream**: View desktop in real-time via iframe
- **Manual Controls**: Quick actions (Screenshot, Left Click, Right Click, Ctrl+C)
- **Connection Status**: Visual indicator (green/red dot)

### Agent Tab
- **Task Input**: Describe what you want the agent to do
- **Iteration Control**: Set max iterations
- **Start/Stop Controls**: Manage agent execution
- **Live Statistics**: Actions, screenshots, commands executed

### History Tab
- **Action Log**: Complete history of all actions
- **Success/Failure Indicators**: Color-coded results
- **Timestamps**: When each action was executed

### Terminal Tab
- **Command Execution**: Run terminal commands directly
- **Live Output**: Real-time command output
- **Command History**: Timestamped log

---

## Computer Use Agent Loop

### Basic Agent Loop

```typescript
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider-enhanced'
import { getComputerUseSystemPrompt } from '@/lib/sandbox/providers/computer-use-tools-enhanced'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Create desktop
const desktop = await e2bDesktopProvider.createDesktop()

// Run agent loop
const result = await desktop.runAgentLoop(
  async (screenshotBase64, iteration) => {
    // Call LLM with screenshot
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: getComputerUseSystemPrompt(),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Open Firefox and navigate to example.com' },
            {
              type: 'image_url',
              image_url: `data:image/png;base64,${screenshotBase64}`,
            },
          ],
        },
      ],
      tools: Object.values(computerUseTools),
      tool_choice: 'auto',
    })

    // Extract action from tool call
    const toolCall = response.choices[0].message.tool_calls?.[0]
    if (!toolCall) return null

    return {
      type: toolCall.function.name,
      ...JSON.parse(toolCall.function.arguments),
    }
  },
  {
    maxIterations: 50,
    onIteration: (iteration, action, result) => {
      console.log(`Iteration ${iteration}:`, action, result)
    },
  }
)

console.log('Agent completed:', result)
```

### With Vercel AI SDK

```typescript
import { streamText } from 'ai'
import { computerUseTools, toolCallToAction } from '@/lib/sandbox/providers/computer-use-tools-enhanced'

const result = streamText({
  model: openai('gpt-4o'),
  system: getComputerUseSystemPrompt(),
  messages,
  tools: computerUseTools,
  maxSteps: 50,
  onStepFinish: async ({ toolCalls, toolResults }) => {
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i]
      const action = toolCallToAction(toolCall.toolName, toolCall.args)

      if (action) {
        const toolResult = await desktop.executeAction(action)
        console.log('Tool result:', toolResult)
      }
    }
  },
})
```

---

## Available Actions

### Mouse Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `mouse_move` | Move mouse to coordinates | `x`, `y` |
| `left_click` | Left mouse click | `x?`, `y?` |
| `right_click` | Right mouse click | `x?`, `y?` |
| `double_click` | Double click | `x?`, `y?` |
| `middle_click` | Middle click | `x?`, `y?` |
| `drag` | Drag from start to end | `startX`, `startY`, `endX`, `endY` |
| `scroll` | Scroll up or down | `direction`, `ticks?` |

### Keyboard Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `type` | Type text | `text` |
| `keypress` | Press key(s) | `keys` (array) |

### Utility Actions

| Action | Description | Parameters |
|--------|-------------|------------|
| `screenshot` | Capture screen | - |
| `wait` | Wait duration | `duration` (ms) |
| `terminal_command` | Execute command | `command`, `cwd?`, `timeout?` |

---

## Common Key Names

```
Enter, Return, Tab, Escape, Space
Control_L, Control_R (Ctrl)
Alt_L, Alt_R
Shift_L, Shift_R
F1-F12 (function keys)
arrow_up, arrow_down, arrow_left, arrow_right
Home, End, Page_Up, Page_Down
BackSpace, Delete, Insert
```

---

## Example Workflows

### 1. Web Browsing

```typescript
// Open Firefox
await desktop.runCommand('firefox &')
await new Promise(resolve => setTimeout(resolve, 3000))

// Click address bar (typical position)
await desktop.moveMouse(400, 50)
await desktop.leftClick()

// Type URL
await desktop.type('https://example.com')
await desktop.press(['Enter'])

// Wait for page load
await new Promise(resolve => setTimeout(resolve, 5000))

// Take screenshot to verify
const screenshot = await desktop.screenshot()
```

### 2. File Management

```typescript
// Open file manager
await desktop.runCommand('pcmanfm &')
await new Promise(resolve => setTimeout(resolve, 2000))

// Navigate to Documents
await desktop.moveMouse(100, 200)
await desktop.leftClick()
await desktop.doubleClick()

// Create new folder (right-click menu)
await desktop.rightClick(400, 300)
await desktop.moveMouse(450, 350) // "New Folder" position
await desktop.leftClick()
await desktop.type('My Folder')
await desktop.press(['Enter'])
```

### 3. Text Editing

```typescript
// Open LibreOffice Writer
await desktop.runCommand('libreoffice --writer &')
await new Promise(resolve => setTimeout(resolve, 3000))

// Type document
await desktop.type('My Document')
await desktop.press(['Enter'])
await desktop.type('This is a test document.')

// Save (Ctrl+S)
await desktop.hotkey('Control_L', 's')
await new Promise(resolve => setTimeout(resolve, 1000))

// Type filename
await desktop.type('test.odt')
await desktop.press(['Enter'])
```

---

## Environment Variables

```bash
# E2B API Key (required)
E2B_API_KEY=e2b_your_api_key_here

# Desktop configuration (optional)
E2B_DESKTOP_TIMEOUT=300000        # 5 minutes
E2B_DESKTOP_RESOLUTION_X=1024
E2B_DESKTOP_RESOLUTION_Y=720
E2B_DESKTOP_DPI=96
```

---

## Best Practices

### 1. Always Screenshot First
```typescript
// Understand desktop state before acting
const screenshot = await desktop.screenshot()
// Analyze screenshot with LLM before taking action
```

### 2. Use Wait Actions
```typescript
// Allow time for animations and loading
await desktop.executeAction({ type: 'wait', duration: 2000 })
```

### 3. Verify with Screenshots
```typescript
// Check results after important actions
await desktop.leftClick()
await new Promise(resolve => setTimeout(resolve, 1000))
const result = await desktop.screenshot()
```

### 4. Small Steps
```typescript
// Break complex tasks into simple actions
await desktop.moveMouse(100, 200)
await desktop.leftClick()
await new Promise(resolve => setTimeout(resolve, 500))
await desktop.type('text')
```

### 5. Handle Errors
```typescript
const result = await desktop.executeAction(action)
if (!result.success) {
  console.error('Action failed:', result.output)
  // Try alternative approach
}
```

### 6. Clean Up
```typescript
// Always kill desktop sandboxes when done
await desktop.kill()

// Or use auto-cleanup
const desktop = await e2bDesktopProvider.createDesktop({
  autoCleanup: true,
})
```

---

## Error Handling

```typescript
try {
  const result = await desktop.executeAction({
    type: 'left_click',
    x: 500,
    y: 300,
  })

  if (!result.success) {
    console.error('Action failed:', result.output)
    // Retry or try alternative
  }
} catch (error: any) {
  console.error('Desktop action error:', error)
  // Handle error
}
```

---

## Performance Optimization

### 1. Batch Actions
```typescript
// Execute multiple actions efficiently
const actions: DesktopAction[] = [
  { type: 'mouse_move', x: 100, y: 200 },
  { type: 'left_click' },
  { type: 'wait', duration: 500 },
  { type: 'type', text: 'Hello' },
]

const results = await desktop.executeActions(actions)
```

### 2. Adjust Delays
```typescript
// Reduce delay between actions for faster execution
await desktop.runAgentLoop(getActionFromLLM, {
  actionDelay: 200, // Faster than default 500ms
})
```

### 3. Limit Iterations
```typescript
// Prevent infinite loops
await desktop.runAgentLoop(getActionFromLLM, {
  maxIterations: 20, // Lower than default 50
})
```

---

## Troubleshooting

### Issue: Desktop won't connect

**Solution**:
1. Check `E2B_API_KEY` is set correctly
2. Verify `@e2b/desktop` is installed: `pnpm list @e2b/desktop`
3. Check quota: E2B free tier has limits

### Issue: Actions fail silently

**Solution**:
1. Check desktop is alive: `desktop.isAlive()`
2. Verify coordinates are within screen bounds (0-1024, 0-720)
3. Add wait actions between rapid actions

### Issue: Agent loop doesn't stop

**Solution**:
1. Ensure LLM returns `null` when task is complete
2. Set appropriate `maxIterations`
3. Use `stopAgent()` button in UI

### Issue: VNC stream doesn't load

**Solution**:
1. Check `startStreaming: true` in config
2. Verify firewall allows VNC connection
3. Try different browser (Chrome recommended)

---

## API Reference

### DesktopSandboxHandle

```typescript
class DesktopSandboxHandle {
  // Properties
  readonly id: string
  readonly streamUrl?: string

  // Lifecycle
  isAlive(): boolean
  kill(): Promise<void>
  setTimeout(timeoutMs: number): Promise<void>
  getInfo(): Promise<{...}>

  // Screenshot
  screenshot(): Promise<Buffer>
  screenshotBase64(): Promise<string>
  screenshotDataUrl(): Promise<string>

  // Mouse
  moveMouse(x: number, y: number): Promise<ToolResult>
  leftClick(x?: number, y?: number): Promise<ToolResult>
  rightClick(x?: number, y?: number): Promise<ToolResult>
  doubleClick(x?: number, y?: number): Promise<ToolResult>
  drag(startX, startY, endX, endY): Promise<ToolResult>
  scroll(direction, ticks): Promise<ToolResult>

  // Keyboard
  type(text: string): Promise<ToolResult>
  press(keys): Promise<ToolResult>
  hotkey(...keys): Promise<ToolResult>

  // Combined
  executeAction(action): Promise<ToolResult>
  executeActions(actions[]): Promise<ToolResult[]>
  runCommand(command, cwd?, timeout?): Promise<ToolResult>

  // Agent Loop
  runAgentLoop(getActionFromLLM, config): Promise<AgentLoopResult>

  // Stats
  getStats(): DesktopStats
}
```

### E2BDesktopProvider

```typescript
class E2BDesktopProvider {
  readonly name: string

  createDesktop(config?): Promise<DesktopSandboxHandle>
  getDesktop(sandboxId): Promise<DesktopSandboxHandle>
  destroyDesktop(sandboxId): Promise<void>
  getActiveDesktops(): DesktopSandboxHandle[]
  cleanupAll(): Promise<void>
}
```

---

## References

- [E2B Desktop Docs](https://e2b.dev/docs/template/examples/desktop)
- [Computer Use Guide](https://e2b.dev/docs/computer-use)
- [E2B Surf (Reference)](https://github.com/e2b-dev/surf)
- [Live Demo](https://surf.e2b.dev)

---

**Implementation Date**: 2026-02-27  
**Status**: ✅ Production Ready
