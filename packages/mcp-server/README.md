# binG MCP Server

[![npm version](https://badge.fury.io/js/@bing%2Fmcp-server.svg)](https://badge.fury.io/js/@bing%2Fmcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://smithery.ai/server/@quazfenton/binG)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

**binG MCP Server** is a standalone Model Context Protocol (MCP) server that provides filesystem operations and command execution for AI agents. It runs as a stdio process, connecting to MCP clients like Claude Desktop, Cursor, or other IDE integrations.

## Features

### ✅ Implemented Tools

#### Filesystem Operations
- **`read_file`** — Read file contents with size limits and path validation
- **`write_file`** — Write files with automatic directory creation
- **`list_directory`** — List directory contents with metadata (type, size, modification date)

#### Command Execution
- **`execute_command`** — Execute shell commands with:
  - Timeout protection (configurable, default 30s)
  - Working directory support
  - Path validation (prevents directory traversal)
  - Output buffering (stdout + stderr)
  - Configurable enable/disable flag

### 🚧 Stubbed Tools (Require Full binG Web Server)

These tools are defined for protocol compatibility but require the full binG web server infrastructure:

- **`create_agent`** — Agent orchestration (requires AI provider integration)
- **`get_agent_status`** — Agent status tracking (requires session management)
- **`stop_agent`** — Agent lifecycle management (requires agent infrastructure)
- **`spawn_agent_session`** — Persistent sessions (requires session storage)
- **`voice_speech`** — TTS synthesis (requires ElevenLabs/Cartesia integration)
- **`generate_image`** — Image generation (requires FLUX/SDXL provider)

## Installation

### npm
```bash
npm install -g @bing/mcp-server
```

### From Source
```bash
cd packages/mcp-server
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BING_WORKSPACE_ROOT` | Root directory for file operations | `process.cwd()` |
| `BING_MAX_COMMAND_TIMEOUT` | Maximum command execution time (ms) | `30000` (30s) |
| `BING_MAX_READ_FILE_SIZE` | Maximum file size for read operations | `1048576` (1MB) |
| `BING_ENABLE_COMMAND_EXECUTION` | Enable command execution | `true` |

### Examples

```bash
# Set workspace to specific directory
export BING_WORKSPACE_ROOT=/path/to/my/project

# Disable command execution (read-only mode)
export BING_ENABLE_COMMAND_EXECUTION=false

# Increase timeout for long-running commands
export BING_MAX_COMMAND_TIMEOUT=60000
```

## Usage

### CLI
```bash
# Start the MCP server
bing-mcp

# Or run directly
node dist/stdio-server.js
```

The server communicates via stdio (stdin/stdout) with the MCP client.

### Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "binG": {
      "command": "node",
      "args": ["/path/to/binG/packages/mcp-server/dist/stdio-server.js"],
      "env": {
        "BING_WORKSPACE_ROOT": "/path/to/your/workspace"
      }
    }
  }
}
```

### Cursor/IDE Integration

Configure your IDE's MCP settings to point to the `bing-mcp` binary or `stdio-server.js` script.

## Available Tools

### File Operations

#### `read_file`
Read the contents of a file.

**Parameters:**
- `path` (string, required) — File path relative to workspace root

**Security:**
- Path traversal protection
- File size limit enforced (default 1MB)
- Returns error if file not found or too large

**Example:**
```json
{
  "tool": "read_file",
  "arguments": {
    "path": "src/index.ts"
  }
}
```

#### `write_file`
Create or overwrite a file. Automatically creates parent directories.

**Parameters:**
- `path` (string, required) — File path relative to workspace root
- `content` (string, required) — File content

**Security:**
- Path traversal protection
- Automatic directory creation

**Example:**
```json
{
  "tool": "write_file",
  "arguments": {
    "path": "src/hello.ts",
    "content": "console.log('Hello, binG!');"
  }
}
```

#### `list_directory`
List directory contents with metadata.

**Parameters:**
- `path` (string, optional) — Directory path (default: workspace root)

**Output Format:**
```
type   size    modified    name
file   1.2KB  2026-04-06  index.ts
dir       -   2026-04-06  components
```

**Example:**
```json
{
  "tool": "list_directory",
  "arguments": {
    "path": "src"
  }
}
```

### Command Execution

#### `execute_command`
Execute shell commands with timeout and working directory support.

**Parameters:**
- `command` (string, required) — Shell command to execute
- `workingDir` (string, optional) — Working directory (relative to workspace root)
- `timeout` (number, optional) — Timeout in milliseconds (default: 30000)

**Security:**
- Path validation on working directory
- Timeout enforcement
- Output size limit (10MB buffer)
- Can be disabled via `BING_ENABLE_COMMAND_EXECUTION=false`

**Example:**
```json
{
  "tool": "execute_command",
  "arguments": {
    "command": "npm install",
    "workingDir": "my-project",
    "timeout": 60000
  }
}
```

## Security

### Path Validation
All file operations use path validation to prevent directory traversal attacks. Requested paths are resolved and checked against the workspace root to ensure they don't escape the allowed directory.

### Command Execution Safety
- Commands execute with the user's permissions (no additional sandboxing in standalone mode)
- Timeout protection prevents runaway processes
- Can be disabled for read-only deployments
- Output buffered with 10MB limit

### Recommendations for Production
- Run in a container or VM with resource limits
- Use a dedicated service account with minimal permissions
- Set `BING_WORKSPACE_ROOT` to an isolated directory
- Monitor command execution logs
- Consider disabling command execution if not needed

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode (with file watching)
npm run dev

# Start the server
npm start
```

## Architecture

```
┌─────────────────┐
│   MCP Client    │
│ (Claude Desktop,│
│  Cursor, IDE)   │
└────────┬────────┘
         │ stdio (stdin/stdout)
         │
┌────────▼────────┐
│  binG MCP       │
│  Server         │
│                 │
│  ┌───────────┐  │
│  │read_file  │  │──→ Node.js fs/promises
│  └───────────┘  │
│  ┌───────────┐  │
│  │write_file │  │──→ Node.js fs/promises
│  └───────────┘  │
│  ┌───────────┐  │
│  │list_dir   │  │──→ Node.js fs/promises
│  └───────────┘  │
│  ┌───────────┐  │
│  │exec_cmd   │  │──→ child_process.exec
│  └───────────┘  │
└─────────────────┘
```

## Relationship to Full binG Platform

This package is the **standalone MCP server** component of the larger binG platform. It provides:

- ✅ Local filesystem operations (wired to Node.js `fs/promises`)
- ✅ Command execution (wired to `child_process.exec` with safety limits)
- ❌ VFS integration (requires web server's `VirtualFilesystemService`)
- ❌ Sandbox providers (requires Daytona/E2B/etc. infrastructure)
- ❌ Agent orchestration (requires AI provider integration)
- ❌ Voice/image generation (requires external API integrations)

For the full binG experience with VFS, sandbox execution, and agent orchestration, deploy the complete binG web application.

## Troubleshooting

### Server Won't Start
1. Check that `BING_WORKSPACE_ROOT` points to an existing directory
2. Verify Node.js version >= 20.0.0
3. Run with `npm run dev` to see detailed error output

### "Path traversal detected" Error
The requested file path resolves outside the workspace root. Use relative paths or ensure the absolute path is within `BING_WORKSPACE_ROOT`.

### Command Execution Disabled
Set `BING_ENABLE_COMMAND_EXECUTION=true` in your environment.

### File Too Large Error
Increase `BING_MAX_READ_FILE_SIZE` or read the file in chunks using command execution (`head`, `cat`, etc.).

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- [GitHub](https://github.com/quazfenton/binG)
- [npm](https://www.npmjs.com/package/@bing/mcp-server)
- [Smithery](https://smithery.ai/server/@quazfenton/binG)
- [Documentation](https://github.com/quazfenton/binG/docs)
