# Computer Use Agent - E2B Desktop Integration

## Overview

This implementation provides computer use capabilities for AI agents to interact with graphical desktop environments using E2B's Desktop SDK.

## Installation

```bash
npm install @e2b/desktop
```

## Quick Start

### Basic Desktop Sandbox

```typescript
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider'

// Create desktop sandbox with VNC streaming
const desktop = await e2bDesktopProvider.createDesktop({
  resolution: [1024, 720],
  dpi: 96,
  timeoutMs: 300000, // 5 minutes
  startStreaming: true,
})

console.log('View desktop at:', desktop.getStreamUrl())

// Take a screenshot
const screenshot = await desktop.screenshot()
console.log('Screenshot size:', screenshot.length, 'bytes')

// Mouse actions
await desktop.moveMouse(500, 300)
await desktop.leftClick()
await desktop.typeText('Hello, Desktop!')

// Keyboard actions
await desktop.pressKey('Enter')
await desktop.hotkey('Control_L', 'c') // Ctrl+C

// Cleanup
await desktop.kill()
```

### Computer Use Agent Loop

```typescript
import { e2bDesktopProvider } from '@/lib/sandbox/providers/e2b-desktop-provider'
import { getComputerUseSystemPrompt } from '@/lib/sandbox/providers/computer-use-tools'
import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Create desktop
const desktop = await e2bDesktopProvider.createDesktop({
  startStreaming: true,
})

// Computer use agent loop
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
            {
              type: 'text',
              text: 'Open Firefox and navigate to example.com',
            },
            {
              type: 'image_url',
              image_url: `data:image/png;base64,${screenshotBase64}`,
            },
          ],
        },
      ],
      tools: computerUseTools,
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

## Tool Calling Integration

### Using Vercel AI SDK

```typescript
import { streamText } from 'ai'
import { computerUseTools, toolCallToAction } from '@/lib/sandbox/providers/computer-use-tools'

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

### Using OpenAI Directly

```typescript
import { computerUseTools } from '@/lib/sandbox/providers/computer-use-tools'

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    {
      role: 'system',
      content: getComputerUseSystemPrompt(),
    },
    {
      role: 'user',
      content: 'Open a terminal and run ls -la',
    },
  ],
  tools: computerUseTools,
  tool_choice: 'auto',
})

// Process tool calls
for (const toolCall of response.choices[0].message.tool_calls) {
  const args = JSON.parse(toolCall.function.arguments)
  
  if (toolCall.function.name === 'left_click') {
    await desktop.leftClick(args.x, args.y)
  } else if (toolCall.function.name === 'type_text') {
    await desktop.typeText(args.text)
  }
  // ... handle other tools
}
```

## Available Tools

### Mouse Actions

| Tool | Description | Parameters |
|------|-------------|------------|
| `mouse_move` | Move mouse to coordinates | `x`, `y` |
| `left_click` | Left mouse click | `x?`, `y?` |
| `right_click` | Right mouse click | `x?`, `y?` |
| `double_click` | Double click | `x?`, `y?` |
| `drag_mouse` | Drag from start to end | `startX`, `startY`, `endX`, `endY` |
| `scroll` | Scroll up or down | `direction`, `ticks?` |

### Keyboard Actions

| Tool | Description | Parameters |
|------|-------------|------------|
| `type_text` | Type text | `text` |
| `press_key` | Press key(s) | `keys` (array) |

### Utility Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `take_screenshot` | Capture screen | - |
| `wait` | Wait duration | `duration` (ms) |
| `run_terminal_command` | Execute command | `command`, `cwd?`, `timeout?` |

## Common Key Names

```
Enter, Return, Tab, Escape, Space
Control_L, Control_R (Ctrl)
Alt_L, Alt_R
Shift_L, Shift_R
F1-F12 (function keys)
arrow_up, arrow_down, arrow_left, arrow_right
```

## Example: Web Browsing Agent

```typescript
const desktop = await e2bDesktopProvider.createDesktop()

// Open Firefox
await desktop.runCommand('firefox &')
await desktop.wait({ duration: 3000 })

// Click address bar (typical position)
await desktop.mouse_move(400, 50)
await desktop.left_click()

// Type URL
await desktop.type_text('https://example.com')
await desktop.press_key(['Enter'])

// Wait for page load
await desktop.wait({ duration: 5000 })

// Take screenshot to verify
const screenshot = await desktop.screenshot()
```

## Example: File Management Agent

```typescript
// Open file manager
await desktop.runCommand('pcmanfm &')
await desktop.wait({ duration: 2000 })

// Navigate to Documents
await desktop.mouse_move(100, 200)
await desktop.left_click()
await desktop.double_click()

// Create new folder (right-click menu)
await desktop.rightClick(400, 300)
await desktop.mouse_move(450, 350) // "New Folder" position
await desktop.left_click()
await desktop.type_text('My Folder')
await desktop.press_key(['Enter'])
```

## Environment Variables

```bash
# E2B API Key (required)
E2B_API_KEY=e2b_your_api_key_here

# Desktop configuration
E2B_DESKTOP_TIMEOUT=300000
E2B_DESKTOP_RESOLUTION_X=1024
E2B_DESKTOP_RESOLUTION_Y=720
E2B_DESKTOP_DPI=96
E2B_DESKTOP_AUTO_STREAM=true
```

## VNC Streaming

The desktop sandbox includes VNC streaming for browser-based viewing:

```typescript
const desktop = await e2bDesktopProvider.createDesktop({
  startStreaming: true,
})

// Get VNC URL
const streamUrl = desktop.getStreamUrl()
console.log('View desktop at:', streamUrl)

// Use in your frontend
// <iframe src={streamUrl} width="1024" height="720" />
```

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
  }
} catch (error) {
  console.error('Desktop action error:', error)
}
```

## Best Practices

1. **Always screenshot first** - Understand desktop state before acting
2. **Use wait actions** - Allow time for animations and loading
3. **Verify with screenshots** - Check results after important actions
4. **Small steps** - Break complex tasks into simple actions
5. **Handle errors** - Check tool results and retry if needed
6. **Clean up** - Kill desktop sandboxes when done

## References

- [E2B Desktop Docs](https://e2b.dev/docs/template/examples/desktop)
- [Computer Use Guide](https://e2b.dev/docs/computer-use)
- [E2B Surf (Reference)](https://github.com/e2b-dev/surf)
- [Live Demo](https://surf.e2b.dev)
