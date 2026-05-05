# Desktop Automation Integration

Cross-platform desktop automation via agent-desktop integration in the Tauri desktop app.

## Overview

This integration provides native desktop automation capabilities through Tauri IPC commands, allowing the LLM agent to observe and interact with desktop applications via OS accessibility trees.

## Platform Support Matrix

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| **list_windows** | ✅ Full | ✅ Full | ✅ Full |
| **list_apps** | ✅ Full | ✅ Full | ✅ Full |
| **screenshot** | ✅ Full | ⚠️ CLI fallback | ✅ Full |
| **press_key** | ✅ Full | ✅ Full | ✅ Full |
| **launch_app** | ✅ Full | ✅ Full | ✅ Full |
| **close_app** | ✅ Full | ✅ Full | ✅ Full |
| **clipboard_get** | ✅ Full | ✅ Full | ✅ Full |
| **clipboard_set** | ✅ Full | ✅ Full | ✅ Full |
| **snapshot** | ⚠️ CLI | ⚠️ CLI | ⚠️ CLI |
| **click/type** | ⚠️ CLI | ⚠️ CLI | ⚠️ CLI |

**Legend:**
- ✅ Full: Native implementation works without external dependencies
- ⚠️ CLI: Requires agent-desktop CLI binary for complete functionality

## Installation

### Dependencies by Platform

**macOS:**
- No additional installation required
- Accessibility permission must be granted

**Windows:**
- No additional installation required
- UIAutomation API is built into Windows

**Linux:**
```bash
# Window management
sudo apt install wmctrl

# Screenshots
sudo apt install imagemagick

# Keyboard/mouse automation
sudo apt install xdotool

# Clipboard
sudo apt install xclip
```

### Permissions

**macOS:**
Grant Accessibility permission in System Settings > Privacy & Security > Accessibility. Add your terminal or the Quaz Desktop app.

**Windows:**
No special permissions required. UIAutomation works out of the box.

**Linux:**
Ensure AT-SPI is enabled in your desktop environment settings.

## Capability IDs

```
desktop.snapshot      - Capture accessibility tree of an application
desktop.click         - Click on a UI element by ref ID
desktop.type          - Type text into a UI element
desktop.screenshot    - Capture screen or window screenshot
desktop.clipboard_get - Read system clipboard text
desktop.clipboard_set - Write text to system clipboard
desktop.key_press     - Press keyboard shortcut (e.g., "cmd+s")
desktop.launch_app    - Launch an application by name or bundle ID
desktop.close_app     - Close/quit an application
desktop.list_windows  - List all visible windows
desktop.list_apps     - List all running GUI applications
```

## Usage Examples

### List Windows

```typescript
const result = await executeCapability('desktop.list_windows', {});
// Returns: { ok: true, data: [{ id: "win-0", title: "Documents", app_name: "Finder", pid: 12345 }] }
```

### Take Screenshot

```typescript
const result = await executeCapability('desktop.screenshot', {
  quality: 80  // JPEG quality 1-100
});
// Returns: { ok: true, data: { width: 1920, height: 1080, imageBase64: "...", format: "png" } }
```

### Launch Application

```typescript
await executeCapability('desktop.launch_app', {
  appId: "Safari",
  wait: true
});
```

### Press Keyboard Shortcut

```typescript
await executeCapability('desktop.key_press', {
  combo: "cmd+s"  // macOS
  // combo: "ctrl+s"  // Windows/Linux
});
```

### Clipboard Operations

```typescript
// Get clipboard
const text = await executeCapability('desktop.clipboard_get', {});

// Set clipboard
await executeCapability('desktop.clipboard_set', {
  text: "Copied text"
});
```

### Close Application

```typescript
await executeCapability('desktop.close_app', {
  appName: "Safari",
  force: false  // Set true for force quit
});
```

## Architecture

### Integration Points

1. **Rust Backend** (`desktop/src-tauri/src/desktop_automation.rs`)
   - Platform-specific implementations
   - Tauri command handlers
   - Direct OS API access

2. **TypeScript Layer** (`web/lib/tools/bootstrap/bootstrap-desktop-automation.ts`)
   - Tool registration
   - Capability routing
   - Type-safe interfaces

3. **Capability Definitions** (`web/lib/tools/capabilities.ts`)
   - Schema definitions with Zod
   - Provider priority configuration
   - Permission requirements

### Data Flow

```
User Prompt
    ↓
Agent decides to use desktop automation
    ↓
Capability Router selects 'tauri-desktop' provider
    ↓
Tool handler calls tauriInvoke.invoke()
    ↓
Tauri IPC to Rust backend
    ↓
Platform-specific implementation (macOS/Windows/Linux)
    ↓
Result returned to agent
```

## Platform Implementation Details

### macOS

Uses Core Graphics and Accessibility APIs:
- `CGWindowListCopyWindowInfo` for window listing
- `CGDisplay.screenshot()` for screen capture
- `AXIsProcessTrusted()` for permission checking
- AppleScript for key presses via System Events

### Windows

Uses UIAutomation API via `uiautomation` crate:
- `UIAutomation::new()` for automation instance
- `get_root_element().find_all()` for window enumeration
- PowerShell `SendKeys` for keyboard input
- PowerShell for app management

### Linux

Uses AT-SPI and external tools:
- `wmctrl` for window listing
- `xdotool` for keyboard/mouse automation
- `xclip` for clipboard
- `import` (ImageMagick) for screenshots
- `atspi` crate for accessibility tree (future)

## Full Snapshot/Interaction Support

For complete accessibility tree snapshot with element refs and AX-first click chains, use the agent-desktop CLI binary:

```typescript
// Via sandbox.shell capability
const result = await executeCapability('sandbox.shell', {
  command: 'agent-desktop snapshot --app Finder -i',
  cwd: '/usr/local/bin'
});

// Parse JSON output
const snapshot = JSON.parse(result.stdout);
```

### agent-desktop CLI Commands

```bash
# Snapshot with interactive elements
agent-desktop snapshot --app Safari -i

# Click by ref
agent-desktop click @e3

# Type into element
agent-desktop type @e5 "hello world"

# Press key combo
agent-desktop press cmd+s

# Progressive traversal (token-efficient)
agent-desktop snapshot --skeleton --app Slack -i --compact
agent-desktop snapshot --root @e3 -i --compact
```

## Troubleshooting

### macOS: Permission Denied

```
Error: Accessibility permission not granted
```

Solution:
1. Open System Settings > Privacy & Security > Accessibility
2. Add your terminal app or Quaz Desktop
3. Restart the application

### Windows: UIAutomation Errors

```
Error: Failed to initialize UIAutomation
```

Solution:
1. Ensure you're running on Windows 10 or later
2. Check that the app isn't running with elevated privileges (some apps block UIAutomation)

### Linux: wmctrl Not Found

```
Error: Failed to list windows (wmctrl not installed?)
```

Solution:
```bash
sudo apt install wmctrl xdotool xclip imagemagick
```

### Linux: AT-SPI Not Available

```
Error: AT_SPI_DBUS_ADDRESS not set
```

Solution:
1. Ensure AT-SPI is enabled in your desktop environment
2. For GNOME: Settings > Universal Access > Screen Reader (enables AT-SPI)
3. For KDE: System Settings > Accessibility

## Security Considerations

- Desktop automation requires explicit accessibility permissions
- All operations are scoped to the user's session
- No network transmission of screen contents
- Clipboard access is limited to text content
- Application launch/close respects user permissions

## Performance Notes

- `list_windows` and `list_apps` complete in <50ms on all platforms
- `screenshot` takes 100-500ms depending on screen resolution
- `press_key` completes in <100ms
- `snapshot` with full tree can take 1-3 seconds for complex apps

## Related Documentation

- [agent-desktop CLI Reference](https://github.com/lahfir/agent-desktop#commands)
- [UIAutomation Rust Crate](https://docs.rs/uiautomation/)
- [AT-SPI Protocol](https://www.linuxfoundation.org/collaborate/workgroups/accessibility/atspi)
- [macOS Accessibility Programming Guide](https://developer.apple.com/library/archive/documentation/Accessibility/Conceptual/AccessibilityMacOSX/)
