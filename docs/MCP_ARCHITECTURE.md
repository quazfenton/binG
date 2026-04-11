# MCP Architecture Guide

## Overview

The Model Context Protocol (MCP) in this codebase has **three layers**: Client, Server, and Gateway. They form a chain where the Client discovers tools from the Server, and the Gateway aggregates multiple Servers into a unified view.

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  MCP Client     │────▶│  MCP Gateway    │────▶│  MCP Servers    │
│  (consumer)     │     │  (aggregator)   │     │  (providers)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                        │                        │
   calls tools            discovers + routes          hosts tools
   from gateway           across all servers          via stdio/HTTP
```

---

## 1. MCP Client (`web/lib/mcp/client.ts`)

**Role:** Discovers and calls tools from MCP servers.

**How it works:**
1. Connects to an MCP server via a transport (stdio, SSE, HTTP)
2. Sends `initialize` → `tools/list` to discover available tools
3. Sends `tools/call` to execute a specific tool with arguments
4. Receives structured results back

**Transports supported:**

| Transport | How it works | Where it runs |
|-----------|-------------|---------------|
| **stdio** | Spawns a child process (`npx -y @some/server`), communicates via stdin/stdout | Desktop only (Node.js `child_process`) |
| **SSE** | Connects to a remote server's `/sse` endpoint, receives events | Web + Desktop |
| **HTTP** | Sends POST requests to `/tools/call`, GET to `/tools/list` | Web + Desktop |
| **Streamable HTTP** | Streaming POST requests with Server-Sent Events responses | Web + Desktop |

**Key file:** `web/lib/mcp/client.ts`

---

## 2. MCP Server (`web/app/api/mcp/route.ts`, `web/lib/mcp/mcp-http-server.ts`)

**Role:** Hosts tools and responds to client requests.

**How it works:**
1. Registers tools (VFS write_file, read_file, mem0 tools, etc.)
2. Responds to `tools/list` with tool definitions (name, description, input schema)
3. Responds to `tools/call` by executing the tool and returning results

**Your MCP servers:**

| Server | File | Transport | Tools Hosted |
|--------|------|-----------|-------------|
| **VFS MCP Server** | `web/app/api/mcp/route.ts` | Next.js HTTP | write_file, read_file, apply_diff, batch_write, + mem0 tools |
| **MCP HTTP Server (CLI)** | `web/lib/mcp/mcp-http-server.ts` | Local HTTP (port 8888) | All tools from registry + `/memory/*` endpoints |

**Protocol flow:**
```
Client: POST /tools/list
Server: [{"name": "write_file", "description": "...", "inputSchema": {...}}, ...]

Client: POST /tools/call {"name": "write_file", "arguments": {"path": "test.js", "content": "..."}}
Server: {"success": true, "output": {...}}
```

**Key files:**
- `web/app/api/mcp/route.ts` — JSON-RPC MCP server (Next.js route)
- `web/lib/mcp/mcp-http-server.ts` — Plain HTTP server for CLI agents (port 8888)

---

## 3. MCP Gateway (`web/lib/mcp/mcp-gateway.ts`, `web/lib/mcp/gateway.ts`)

**Role:** Aggregates multiple MCP servers, provides a unified tool view, routes tool calls to the right server.

**How it works:**
1. Connects to multiple remote MCP servers at startup
2. Fetches tool lists from each server
3. Merges them into a single catalog
4. When a tool is called, finds which server hosts it, forwards the request

**Features:**
- **Health checks** — pings servers periodically, marks unhealthy ones
- **Auto-reconnect** — retries failed connections
- **Load balancing** — if multiple servers have the same tool, picks the best one
- **Tool discovery** — `listTools()` returns everything from all servers

**Your gateway implementations:**

| Gateway | File | Purpose |
|---------|------|---------|
| **HTTP Gateway** | `web/lib/mcp/mcp-gateway.ts` | Connects to remote MCP servers over HTTP/SSE, health checks, auto-reconnect |
| **Agent Kernel Integration** | `web/lib/mcp/agent-kernel-integration.ts` | Agent Kernel task submission, agent lifecycle, DAG workflow execution |

**Protocol flow:**
```
Gateway: GET http://server1:8000/tools  →  [{"name": "read_file", ...}]
Gateway: GET http://server2:9000/tools  →  [{"name": "git_commit", ...}]

Agent calls: "git_commit"  →  Gateway routes to server2
Agent calls: "read_file"   →  Gateway routes to server1
```

**Key files:**
- `web/lib/mcp/mcp-gateway.ts` — HTTP-based gateway with health checks
- `web/lib/mcp/gateway.ts` — Agent Kernel + DAG integration

---

## Web vs Desktop: What's Supported?

| Feature | Web Mode | Desktop Mode |
|---------|:--------:|:------------:|
| **Remote HTTP MCP servers** | ✅ Yes | ✅ Yes |
| **Remote SSE MCP servers** | ✅ Yes | ✅ Yes |
| **Streamable HTTP MCP servers** | ✅ Yes | ✅ Yes |
| **stdio (npx) MCP servers** | ❌ Blocked | ✅ Yes |
| **Local MCP servers (npx -y)** | ❌ Blocked | ✅ Yes |
| **Gateway to remote servers** | ✅ Yes | ✅ Yes |
| **MCP HTTP server (port 8888)** | ✅ Yes | ✅ Yes |

### Why stdio is blocked on web

stdio requires `child_process.spawn()` — a Node.js API that doesn't exist in the browser. The registry explicitly rejects stdio configs in web mode:

```typescript
// registry.ts line 70
const isDesktop = process.env.DESKTOP_MODE === 'true';
if (config.transport?.type === 'stdio' && !isDesktop) {
  console.error(`[MCPRegistry] REJECTED stdio server in web mode: ${config.name}`)
  return
}
```

### How to connect to remote servers on web

1. **Via environment variable:**
   ```env
   MCP_SERVERS=server1|http://remote-host:8000|token1,server2|http://other:9000|token2
   ```

2. **Via config file (`mcp.web.json`):**
   ```json
   {
     "servers": [
       {
         "id": "remote-filesystem",
         "name": "Remote Filesystem",
         "transport": {
           "type": "http",
           "url": "http://remote-host:8000/mcp"
         }
       }
     ]
   }
   ```

3. **Via `http-transport.ts` directly:**
   ```typescript
   import { createHTTPTransport, registerHTTPTransport } from '@/lib/mcp/http-transport';
   
   const transport = createHTTPTransport({
     url: 'http://remote-host:8000/mcp',
     authToken: 'your-token',
   });
   registerHTTPTransport('remote-server', transport);
   ```

---

## Mem0 Memory Integration

### How Mem0 Works (No Local SDK Needed)

Mem0 is a **cloud REST API** at `https://api.mem0.ai`. There is **no local SDK, no local database, no local processing**. Everything runs via `fetch()` calls.

**All you need:**
```env
MEM0_API_KEY=your_api_key_here
```

That's it. The `web/lib/powers/mem0-power.ts` module is a thin wrapper — just `fetch()` calls with `Authorization: Token ${apiKey}`.

### What `mem0-power.ts` Actually Does

| Layer | What it does |
|-------|-------------|
| **REST Client** (`Mem0Client` class) | Wraps `fetch()` calls to `api.mem0.ai` for add/search/get/update/delete |
| **Power Actions** (`mem0Add`, `mem0Search`, etc.) | Wraps client calls with error handling, returns `{success, results, error}` |
| **Tool Builder** (`buildMem0Tools`) | Creates Vercel AI SDK `tool()` objects so the LLM can call mem0 as function calls |
| **System Prompt** (`buildMem0SystemPrompt`) | Formats memories into markdown for injection into LLM context |
| **Power Manifest** (`mem0PowerManifest`) | Describes the power to a marketplace/discovery system |

### What it does NOT do

- ❌ No caching layer — every call goes straight to Mem0 API
- ❌ No retry logic — no exponential backoff
- ❌ No local processing — no embedding, summarization, or deduplication
- ❌ No offline mode — fails if API unreachable
- ❌ No rate limiting — no throttling

### Where Mem0 is Wired In

| Integration Point | File | What happens |
|------------------|------|-------------|
| **Chat route (auto-search)** | `web/app/api/chat/route.ts:727` | Before generating response, `mem0Search()` fetches relevant memories |
| **Chat route (auto-store)** | `web/app/api/chat/route.ts:2903` | After response, `storeConversationInMem0()` persists the exchange |
| **LLM tool calling** | `web/lib/mcp/architecture-integration.ts:681` | `buildMem0Tools()` adds `mem0_add`, `mem0_search`, etc. as callable tools |
| **MCP HTTP server** | `web/lib/mcp/mcp-http-server.ts` | `/memory/add`, `/memory/search`, `/memory/all`, `/memory/:id` endpoints |
| **MCP JSON-RPC server** | `web/app/api/mcp/route.ts` | mem0 tools registered in MCP protocol for remote clients |
| **VFS MCP tools** | `web/lib/mcp/vfs-mcp-tools.ts` | `buildMem0MCPTools()` wraps actions for registry execution |

### Mem0 Endpoints (MCP HTTP Server)

```
POST /memory/add     {"messages": [{role: "user", content: "..."}], "userId": "user_123"}
POST /memory/search  {"query": "user preferences", "userId": "user_123", "limit": 10}
GET  /memory/all     ?userId=user_123&limit=50
GET  /memory/status
PATCH /memory/{id}   {"text": "updated memory text"}
DELETE /memory/{id}
DELETE /memory/all   {"userId": "user_123"}
```

### Mem0 Tool Names (for LLM function calling)

```
mem0_add        → Store memories from conversation
mem0_search     → Search memories for relevant context
mem0_get_all    → Get all memories for a user
mem0_update     → Update an existing memory
mem0_delete     → Delete a specific memory
mem0_delete_all → Delete all memories for a user
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              LLM (Mistral/Llama/etc.)                        │
│                                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐                    │
│  │ VFS Tools   │    │ Mem0 Tools   │    │ Other Tools  │                    │
│  │ write_file  │    │ mem0_add     │    │ git_commit   │                    │
│  │ read_file   │    │ mem0_search  │    │ bash_execute │                    │
│  │ apply_diff  │    │ mem0_get_all │    │ arcade_*     │                    │
│  └──────┬──────┘    └──────┬───────┘    └──────┬───────┘                    │
│         │                  │                   │                              │
└─────────┼──────────────────┼───────────────────┼──────────────────────────────┘
          │                  │                   │
          ▼                  ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        getMCPToolsForAI_SDK()                                │
│                                                                             │
│  [Native MCP] [MCPorter] [Blaxel] [Arcade] [Providers] [Composio] [Git]    │
│                                                                             │
│  Assembles all tools into one list, per chat request                         │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MCP Tool Registry                                     │
│                                                                             │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │ stdio Servers    │    │ HTTP/SSE Servers │    │ Remote Servers   │       │
│  │ (desktop only)   │    │ (web + desktop)  │    │ (via gateway)    │       │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘       │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        External Services                                     │
│                                                                             │
│  Mem0 Cloud API          Remote MCP Servers        Agent Kernel             │
│  api.mem0.ai             (HTTP/SSE endpoints)      (DAG workflows)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

| Question | Answer |
|----------|--------|
| Can I connect to remote MCP servers on web? | ✅ Yes, via HTTP or SSE transports |
| Can I use stdio (npx) servers on web? | ❌ No, Node.js `child_process` required |
| Do I need to install a Mem0 SDK? | ❌ No, just set `MEM0_API_KEY` |
| Where is Mem0 data stored? | Mem0 cloud (api.mem0.ai), not locally |
| How many MCP tools are available? | Logged at startup as `[MCP-HTTP]` |
| How do I add a new MCP server? | Add to `mcp.web.json` or `MCP_SERVERS` env var |
| How do I call a tool programmatically? | `mcpToolRegistry.callTool('toolName', args)` |
| How do I list available tools? | `mcpToolRegistry.getToolDefinitions()` |
| How do I check MCP health? | `logMCPStartupHealth()` at startup, per-request logs on `getMCPToolsForAI_SDK()` |
