# MCP Integration Guide

**Model Context Protocol (MCP)** provides AI assistants with access to external tools and data sources.

---

## 🎯 What Each Server Provides

| Server | Purpose | API Key Needed |
|--------|---------|----------------|
| **context7** | Live documentation + framework context injection | ❌ |
| **filesystem** | Read/write local files | ❌ |
| **git** | Git repo analysis | ❌ |
| **fetch** | HTTP requests / API fetching | ❌ |
| **memory** | Persistent memory storage | ❌ |
| **sequential-thinking** | Structured reasoning chains | ❌ |
| **sqlite** | Local SQLite DB querying | ❌ |
| **puppeteer** | Headless browser automation | ❌ |
| **bash** | Run shell commands | ❌ |

**All run locally via `npx` and require:**
- Node.js ≥ 18
- npm or pnpm

---

## 🚀 Quick Start

### 1. Create Configuration File

The project includes `mcp.config.json` with pre-configured servers:

```json
{
  "$schema": "https://json.schemastore.org/mcp.settings.json",
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "git": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-git", "."]
    },
    "fetch": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-fetch"]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    }
  }
}
```

### 2. Enable MCP

Add to `.env.local`:

```bash
# Enable MCP
MCP_ENABLED=true

# Optional: Override config
MCP_AUTO_CONNECT=true
MCP_CONNECTION_TIMEOUT=30000
```

### 3. Initialize in Your App

```typescript
// In app/layout.tsx or server.ts
import { initializeMCPForArchitecture1 } from '@/lib/mcp'

// Call during app initialization
await initializeMCPForArchitecture1()
```

---

## 🏗️ Architecture Support

### Architecture 1: Main LLM (AI SDK)

For the primary LLM call implementation using AI SDK:

```typescript
// 1. Initialize during app startup
import { initializeMCPForArchitecture1, getMCPToolsForAI_SDK } from '@/lib/mcp'

await initializeMCPForArchitecture1()

// 2. Get tools for AI SDK
const mcpTools = getMCPToolsForAI_SDK()

// 3. Use in generateStream/generateText
import { generateStream } from 'ai'

const result = generateStream({
  model: openai('gpt-4o'),
  tools: {
    ...mcpTools,  // MCP tools
    // ... your other tools
  },
  prompt: 'Help me with this task',
})
```

### Architecture 2: OpenCode CLI Agent

For OpenCode CLI agent (containerized):

```typescript
// 1. Initialize MCP HTTP server
import { initializeMCPForArchitecture2 } from '@/lib/mcp'

await initializeMCPForArchitecture2(8888)  // Port 8888

// 2. Generate CLI config
import { generateOpenCodeCLIConfig } from '@/lib/mcp'

const cliConfig = generateOpenCodeCLIConfig()
// Save to .opencode/mcp.json or pass to CLI
```

**OpenCode CLI** can now call MCP tools via HTTP:

```bash
# CLI calls MCP tools via local HTTP server
curl http://localhost:8888/call \
  -H "Content-Type: application/json" \
  -d '{"toolName": "filesystem_read_file", "args": {"path": "README.md"}}'
```

---

## 📁 File Structure

```
lib/mcp/
├── config.ts                 # Configuration loading
├── client.ts                 # MCP client implementation
├── tool-registry.ts          # Tool registry and management
├── architecture-integration.ts  # Architecture 1 & 2 integration
├── mcp-cli-server.ts         # HTTP server for CLI agent
├── index.ts                  # Module exports
└── types.ts                  # TypeScript types

mcp.config.json               # Server configuration
```

---

## 🔧 Configuration Options

### JSON Config (`mcp.config.json`)

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true,
      "timeout": 30000,
      "description": "File system access"
    }
  },
  "mcpSettings": {
    "autoConnect": true,
    "connectionTimeout": 30000,
    "toolCallTimeout": 60000,
    "security": {
      "allowFileSystemAccess": true,
      "allowedPaths": ["./", "./app/", "./lib/"],
      "blockedCommands": ["rm -rf /", "mkfs", "dd"],
      "requireApprovalFor": ["bash", "puppeteer"]
    }
  }
}
```

### Environment Variables

```bash
# Enable/disable MCP
MCP_ENABLED=true

# Connection settings
MCP_AUTO_CONNECT=true
MCP_CONNECTION_TIMEOUT=30000
MCP_TOOL_CALL_TIMEOUT=60000

# Individual server config
MCP_FILESYSTEM_COMMAND=npx
MCP_FILESYSTEM_ARGS=["-y","@modelcontextprotocol/server-filesystem","."]
MCP_FILESYSTEM_ENABLED=true
```

---

## 🛠️ Available Tools

### Context7 (Documentation)
- `context7_get_docs` - Get framework documentation
- `context7_search_docs` - Search documentation

### Filesystem
- `filesystem_read_file` - Read file contents
- `filesystem_write_file` - Write/create files
- `filesystem_list_directory` - List directory contents
- `filesystem_create_directory` - Create directories

### Git
- `git_status` - Get git status
- `git_diff` - Get git diff
- `git_log` - Get git log
- `git_commit` - Create commit

### Fetch
- `fetch_get` - HTTP GET request
- `fetch_post` - HTTP POST request
- `fetch_json` - Fetch and parse JSON

### Sequential Thinking
- `sequential_thinking_analyze` - Structured analysis
- `sequential_thinking_plan` - Create execution plan

---

## 🔒 Security

### Filesystem Access

By default, filesystem access is restricted to project root:

```json
{
  "security": {
    "allowedPaths": ["./", "./app/", "./lib/", "./components/"],
    "blockedCommands": ["rm -rf", "mkfs", "dd", "chmod -R"]
  }
}
```

### Dangerous Tools

Some tools require explicit approval:

```json
{
  "security": {
    "requireApprovalFor": ["bash", "puppeteer"]
  }
}
```

---

## 📊 Monitoring

### Health Check

```typescript
import { checkMCPHealth } from '@/lib/mcp'

const health = checkMCPHealth()
console.log(health)
// {
//   available: true,
//   toolCount: 15,
//   serverStatuses: [...]
// }
```

### API Endpoint

```typescript
// app/api/mcp/health/route.ts
import { handleMCPHealthCheck } from '@/lib/mcp'

export async function GET() {
  return Response.json(await handleMCPHealthCheck())
}
```

---

## 🐛 Troubleshooting

### "No MCP servers configured"

**Solution:** Create `mcp.config.json` or set `MCP_ENABLED=true`

### "Failed to connect to server"

**Check:**
1. Node.js version ≥ 18
2. Network connectivity
3. Server command is correct

```bash
# Test server manually
npx -y @modelcontextprotocol/server-filesystem .
```

### "Tool not found"

**Check:**
1. Server is enabled in config
2. Server connected successfully
3. Tool name is correct

```typescript
import { isMCPAvailable, getMCPToolCount } from '@/lib/mcp'

console.log('MCP available:', isMCPAvailable())
console.log('Tools:', getMCPToolCount())
```

---

## 📚 Best Enhancement Stack

For minimal but powerful setup:

```json
{
  "mcpServers": {
    "context7": { /* Live docs */ },
    "filesystem": { /* Project awareness */ },
    "git": { /* Git intelligence */ },
    "fetch": { /* Web access */ },
    "sequential-thinking": { /* Structured reasoning */ }
  }
}
```

**Gives you:**
- 📚 Live documentation
- 📁 Project awareness
- 🔀 Git intelligence
- 🌐 Web access
- 🧩 Structured reasoning

**Without ANY API keys!**

---

## 🔗 Resources

- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP Servers Registry](https://github.com/modelcontextprotocol/servers)
- [Context7 MCP](https://github.com/upstash/context7-mcp)

---

**Last Updated:** March 3, 2026
**Version:** 1.0
