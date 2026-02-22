# MCP (Model Context Protocol) Integration

## Overview

The MCP (Model Context Protocol) integration provides standardized tool access from external MCP servers. This allows your AI agent to use tools from various sources like filesystem access, git operations, database queries, browser automation, and more.

**Official MCP Docs:** https://modelcontextprotocol.io/

## Installation

The MCP module is built-in. You only need to install the MCP servers you want to use:

```bash
# Install MCP servers you plan to use
npm install -g @modelcontextprotocol/server-filesystem
npm install -g @modelcontextprotocol/server-git
npm install -g @modelcontextprotocol/server-github
```

## Configuration

### Option 1: Add to main `.env`

Copy settings from `env.mcp.example` to your main `.env`:

```bash
cat env.mcp.example >> .env
# Then edit .env and uncomment/configure servers
```

### Option 2: Use separate `.env.mcp` file

1. Copy the example file:
```bash
cp env.mcp.example .env.mcp
```

2. Enable MCP in your main `.env`:
```env
MCP_ENABLED=true
```

3. Configure servers in `.env.mcp` (automatically loaded when MCP is enabled)

**Note:** The `.env.mcp` file is automatically loaded when you import `@/lib/mcp` if `MCP_ENABLED=true`.

## Quick Start

### 1. Configure MCP Servers

Add to your `.env` file:

```env
MCP_ENABLED=true

# Filesystem server - access local files
MCP_FILESYSTEM_COMMAND=npx
MCP_FILESYSTEM_ARGS=["-y","@modelcontextprotocol/server-filesystem","/home/user"]
MCP_FILESYSTEM_ENABLED=true

# Git server - git operations
MCP_GIT_COMMAND=npx
MCP_GIT_ARGS=["-y","@modelcontextprotocol/server-git","/path/to/repo"]
MCP_GIT_ENABLED=true
```

### 2. Initialize MCP

In your application startup:

```typescript
import { initializeMCP, getMCPTools, callMCPTool } from '@/lib/mcp'

// Initialize all configured MCP servers
await initializeMCP()

// Check available tools
console.log(`Available MCP tools: ${getMCPToolCount()}`)

// Get tools for AI SDK
const tools = getMCPTools()
```

### 3. Use in Chat/Agent

```typescript
import { streamText } from 'ai'
import { getMCPTools, callMCPTool } from '@/lib/mcp'

const result = streamText({
  model,
  messages,
  tools: getMCPTools(),
  maxSteps: 10,
  onStepFinish: async ({ toolCalls }) => {
    for (const toolCall of toolCalls) {
      if (toolCall.toolName.startsWith('filesystem:')) {
        const result = await callMCPTool(toolCall.toolName, toolCall.args)
        console.log('Tool result:', result.output)
      }
    }
  },
})
```

## Available MCP Servers

### Official Servers

| Server | Package | Description |
|--------|---------|-------------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | Access local files securely |
| Git | `@modelcontextprotocol/server-git` | Git operations (commit, push, etc.) |
| GitHub | `@modelcontextprotocol/server-github` | GitHub API access |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | PostgreSQL database access |
| SQLite | `@modelcontextprotocol/server-sqlite` | SQLite database access |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | Browser automation |
| Fetch | `@modelcontextprotocol/server-fetch` | Web content retrieval |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory storage |

### Community Servers

Find more servers at: https://github.com/modelcontextprotocol/servers

## Configuration Methods

### Method 1: JSON Array (MCP_SERVERS)

Multi-line JSON values must be enclosed in quotes:

```env
MCP_SERVERS='[
  {
    "id": "filesystem",
    "name": "Filesystem",
    "enabled": true,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    }
  },
  {
    "id": "github",
    "name": "GitHub",
    "enabled": true,
    "transport": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  }
]'
```

### Method 2: Individual Variables

```env
MCP_<NAME>_COMMAND=<command>
MCP_<NAME>_ARGS=<json-array>
MCP_<NAME>_ENABLED=<true|false>
```

Example:
```env
MCP_FILESYSTEM_COMMAND=npx
MCP_FILESYSTEM_ARGS=["-y","@modelcontextprotocol/server-filesystem","/home/user"]
MCP_FILESYSTEM_ENABLED=true
```

## API Reference

### Initialization

```typescript
import { initializeMCP, shutdownMCP } from '@/lib/mcp'

// Start MCP servers
await initializeMCP()

// Shutdown (on app exit)
await shutdownMCP()
```

### Tool Access

```typescript
import { 
  getMCPTools, 
  callMCPTool, 
  getMCPToolCount,
  isMCPAvailable,
} from '@/lib/mcp'

// Get all tools (AI SDK format)
const tools = getMCPTools()

// Call a tool
const result = await callMCPTool('filesystem:read_file', {
  path: '/home/user/file.txt'
})

if (result.success) {
  console.log('Content:', result.output)
} else {
  console.error('Error:', result.error)
}

// Check availability
if (isMCPAvailable()) {
  console.log(`${getMCPToolCount()} tools available`)
}
```

### Server Management

```typescript
import { 
  getMCPServerStatuses,
  mcpToolRegistry,
} from '@/lib/mcp'

// Get all server statuses
const statuses = getMCPServerStatuses()
for (const status of statuses) {
  console.log(`${status.name}: ${status.info.state}`)
}

// Listen for events
mcpToolRegistry.onEvent((event) => {
  console.log('MCP Event:', event)
})
```

### Advanced: Direct Client Access

```typescript
import { MCPClient, createStdioTransport } from '@/lib/mcp'

// Create client
const client = new MCPClient(
  createStdioTransport('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/home/user'])
)

// Connect
await client.connect()

// List tools
const tools = await client.listTools()

// Call tool
const result = await client.callTool({
  name: 'read_file',
  arguments: { path: '/home/user/file.txt' }
})

// Disconnect
await client.disconnect()
```

## Tool Naming

Tools are qualified by server ID:

```
filesystem:read_file
filesystem:write_file
git:commit
git:push
github:create_issue
postgresql:query
```

## Security Considerations

### Filesystem Access

Limit filesystem access to specific directories:

```env
# Only allow access to /home/user/projects
MCP_FILESYSTEM_ARGS=["-y","@modelcontextprotocol/server-filesystem","/home/user/projects"]
```

### GitHub Token

Store GitHub tokens securely:

```env
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
```

### Database Credentials

Use environment variables for connection strings:

```env
DATABASE_URL=postgresql://user:password@localhost/dbname
MCP_POSTGRESQL_ARGS=["-y","@modelcontextprotocol/server-postgres","$DATABASE_URL"]
```

## Troubleshooting

### Server Won't Start

Check logs:
```typescript
mcpToolRegistry.onEvent((event) => {
  if (event.type === 'server_error') {
    console.error(`Server ${event.serverId} error:`, event.error)
  }
})
```

### Tool Not Found

1. Ensure server is connected: `getMCPServerStatuses()`
2. List available tools: `getMCPTools()`
3. Check tool name format: `serverId:toolName`

### Connection Timeout

Increase timeout:
```env
MCP_DEFAULT_TIMEOUT=120000  # 2 minutes
MCP_<NAME>_TIMEOUT=120000
```

## Examples

### File Operations

```typescript
// Read file
const file = await callMCPTool('filesystem:read_file', {
  path: '/home/user/config.json'
})

// Write file
await callMCPTool('filesystem:write_file', {
  path: '/home/user/output.txt',
  content: 'Hello World'
})

// List directory
const dir = await callMCPTool('filesystem:list_directory', {
  path: '/home/user/projects'
})
```

### Git Operations

```typescript
// Get status
const status = await callMCPTool('git:status', {
  repo_path: '/home/user/project'
})

// Commit changes
await callMCPTool('git:commit', {
  repo_path: '/home/user/project',
  message: 'Add new feature',
  files: ['src/index.ts']
})

// Push changes
await callMCPTool('git:push', {
  repo_path: '/home/user/project',
  remote: 'origin',
  branch: 'main'
})
```

### Database Queries

```typescript
// Query PostgreSQL
const result = await callMCPTool('postgresql:query', {
  sql: 'SELECT * FROM users WHERE active = true'
})

// Query SQLite
const sqliteResult = await callMCPTool('sqlite:query', {
  sql: 'SELECT * FROM items LIMIT 10'
})
```

### Browser Automation

```typescript
// Navigate to page
await callMCPTool('puppeteer:navigate', {
  url: 'https://example.com'
})

// Take screenshot
const screenshot = await callMCPTool('puppeteer:screenshot', {
  selector: 'body'
})

// Click element
await callMCPTool('puppeteer:click', {
  selector: '#submit-button'
})
```

## Resources

- [MCP Specification](https://modelcontextprotocol.io/specification)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Debug MCP servers
