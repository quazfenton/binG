Create comprehensive README for binG Desktop version
# binG Desktop
A desktop-native version of binG that runs locally on your machine using Tauri. Unlike the web-based version that uses cloud sandboxes, binG Desktop provides direct access to your local filesystem and shell.
Overview
binG Desktop transforms the binG coding agent into a native desktop application that:
- Runs locally - No cloud sandboxes, executes directly on your machine
- Uses your filesystem - Full access to your local files and directories
- Native shell access - Execute commands in your preferred shell (PowerShell, bash, etc.)
- Offline capable - Works without internet for local development tasks
Quick Start
Prerequisites
- Node.js 18+
- pnpm 8+
- Rust 1.70+
- Tauri CLI (for development)
Installation
// bash
# Clone the repository
git clone https://github.com/quazfenton/binG.git
cd binG
 
# Install dependencies
pnpm install
 
# Run in development mode
pnpm desktop:dev
 
# Or build for production
pnpm desktop:build
Environment Variables
Create a  .env.local  file with the following:
// bash
# Required for LLM access
ANTHROPIC_API_KEY=your_key_here
# OR
OPENROUTER_API_KEY=your_key_here
 
# Desktop mode (required for desktop execution)
DESKTOP_MODE=true
DESKTOP_LOCAL_EXECUTION=true
 
# Optional: Hitl enforcement (blocks dangerous commands)
# ENFORCE_HITL=true
 
# Optional: Custom workspace location
# DESKTOP_WORKSPACE_ROOT=C:\path\to\workspaces
Desktop Features
1. Local Shell Execution
binG Desktop executes shell commands directly on your machine via your configured shell:
┌─────────────┬─────────────────────┬─────────────────────┐
│ Platform    │ Default Shell       │ Args                │
├─────────────┼─────────────────────┼─────────────────────┤
│ Windows     │ PowerShell          │ -NoProfile -Command │
│ Linux/macOS │ $SHELL or /bin/bash │ -c                  │
└─────────────┴─────────────────────┴─────────────────────┘
2. Workspace Management
- Default workspace:  ~/opencode-workspaces  (Linux/macOS) or  %USERPROFILE%\opencode-workspaces  (Windows)
- Custom workspace: Set  DESKTOP_WORKSPACE_ROOT  environment variable
- Path validation: All file operations are validated to stay within workspace bounds
3. Security Features
Command Blocking
The following dangerous commands are automatically blocked:
// javascript
const BLOCKED_PATTERNS = [
  /^rm\s+-rf\s+\/$/,        // Delete root
  /^mkfs/,                   // Format filesystem
  /^dd\s+if=/,               // Direct disk write
  /:\(\)\{\s*:\|\s*\};:/,    // Fork bomb
  /\/dev\/(sd|hd)[a-z]/,     // Raw disk access
  /^curl\s+.*\|\s*sh/i,      // Remote code execution
  /^wget\s+.*\|\s*sh/i,      // Remote code execution
];
Path Traversal Prevention
All file operations validate that paths remain within the workspace directory.
HITL (Human-in-the-Loop) Enforcement
When  ENFORCE_HITL=true  is set, commands requiring approval are blocked:
// bash
export ENFORCE_HITL=true
4. Onboarding Wizard
First-time users are guided through:
1. Welcome - Introduction to binG Desktop
2. Workspace - Select workspace directory
3. Shell - Configure preferred shell
4. API Keys - Set up LLM provider credentials
5. Complete - Ready to start coding
Access the wizard at  /desktop/onboarding  in development.
5. System Tray Integration
binG Desktop includes system tray support:
- Quick access to app window
- Quit application
6. Native Dialogs
Uses Tauri's native dialog plugin for:
- File/folder selection
- Save dialogs
7. Settings Panel
Access at  /desktop/settings :
- Workspace directory configuration
- Shell selection
- Resource usage monitoring
- Checkpoint management
- File sync status
Architecture
Desktop Mode vs Cloud Mode
┌────────────┬──────────────┬────────────────────┐
│ Feature    │ Desktop Mode │ Cloud Mode         │
├────────────┼──────────────┼────────────────────┤
│ Execution  │ Local shell  │ Remote sandbox     │
│ Filesystem │ Local files  │ Virtual filesystem │
│ Network    │ Direct       │ Via API            │
│ Offline    │ Yes          │ Limited            │
│ Security   │ OS-level     │ Sandboxed          │
└────────────┴──────────────┴────────────────────┘
Key Components
lib/
├── orchestra/           # Agent orchestration
│   ├── agent-loop.ts    # Main agent loop with security
│   └── stateful-agent/  # Stateful agent with HITL
├── sandbox/
│   └── providers/
│       └── desktop-provider.ts  # Local execution provider
├── utils/
│   └── desktop-env.ts   # Desktop environment utilities
└── tauri/
    └── invoke-bridge.ts # IPC between frontend and Tauri
Security Model
1. Workspace isolation: All operations confined to workspace directory
2. Command validation: Dangerous patterns blocked before execution
3. Path traversal prevention: Resolved paths validated against workspace
4. Shell validation: Shell paths verified to exist before execution
5. HITL workflow: Configurable approval for sensitive operations
Configuration
Environment Variables
┌─────────────────────────┬─────────────────────────────────┬──────────────────┐
│ Variable                │ Description                     │ Default          │
├─────────────────────────┼─────────────────────────────────┼──────────────────┤
│ DESKTOP_MODE            │ Enable desktop mode             │ false            │
│ DESKTOP_LOCAL_EXECUTION │ Enable local execution          │ false            │
│ DESKTOP_WORKSPACE_ROOT  │ Custom workspace directory      │ Platform default │
│ ENFORCE_HITL            │ Block commands needing approval │ false            │
│ HITL_WORKFLOW_ID        │ Choose approval workflow        │ desktop          │
└─────────────────────────┴─────────────────────────────────┴──────────────────┘
Approval Workflows
- desktop (default) - Auto-approves most operations, blocks only system-destructive
- permissive - Auto-approves everything
- strict - Requires approval for all file/shell operations
- default - Standard approval rules
Troubleshooting
Shell not found
If you see "shell not found" errors, ensure your shell is available:
// bash
# Linux/macOS - check $SHELL
echo $SHELL
 
# Windows - check PowerShell
where powershell.exe
Path traversal errors
If you get "Path traversal detected" errors, ensure file paths are within your workspace directory.
API key not working
Ensure your LLM provider API key is set correctly in environment variables.
Development
Running in Development
// bash
# Development with hot reload
pnpm desktop:dev
 
# Build for production
pnpm desktop:build