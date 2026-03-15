Expanding **Capability-based Tool Router** and **Unified Tool Registry** is exactly the right place to focus because those two pieces become the **core infrastructure layer for everything else** (OpenCode, MCP, Composio, sandboxes, automation, etc.).

Right now your architecture has:

```
Agent → tool name → prefix router → provider
```

Example:

```
filesystem.write_file
nullclaw_sendDiscord
blaxel_codegenSearch
```

That approach works early but breaks when:

* tools > ~40
* multiple providers implement the same function
* you want intelligent routing
* tools have permissions / costs / latency differences

The **capability + registry model** solves all of that.

---

# 1. Concept: Capability-Based Tool System

Instead of exposing **specific tools**, expose **capabilities**.

Bad (current):

```
filesystem.read_file
filesystem.write_file
blaxel_codegenSearch
```

Better:

```
file.read
file.write
repo.search
repo.modify
sandbox.execute
web.browse
automation.discord
memory.store
```

The **agent requests a capability**, not a tool.

Example request from OpenCode:

```json
{
  "capability": "repo.search",
  "args": {
    "query": "authentication middleware"
  }
}
```

The router decides **which provider implements it**.

---

# 2. Why Capabilities Are Powerful

Capabilities allow:

### Multiple providers per capability

```
repo.search
 ├ Blaxel
 ├ Ripgrep
 └ Embedding search
```

### Dynamic provider selection

Example decision tree:

```
repo.search
   if repo indexed → embeddings
   else if blaxel available → blaxel
   else → ripgrep
```

### Tool abstraction

Agents think in **intent**, not **implementation**.

---

# 3. Architecture Overview

The capability system sits between agents and providers.

```
Agent
  ↓
Capability Router
  ↓
Tool Registry
  ↓
Provider
```

Expanded:

```
Agent
  ↓
Capability Router
  ↓
Capability Resolver
  ↓
Tool Registry
  ↓
Provider Adapter
  ↓
Actual Tool
```

---

# 4. Unified Tool Registry

The **registry is the central index of all tools**.

It answers:

```
What tools exist?
What capability do they implement?
Which provider owns them?
What are their costs / latency?
```

Example registry entry:

```ts
{
  name: "filesystem.read_file",
  capability: "file.read",
  provider: "mcp",
  handler: readFile,
  cost: "low",
  latency: "low",
  permissions: ["workspace"]
}
```

Another:

```ts
{
  name: "blaxel_codegenSearch",
  capability: "repo.search",
  provider: "blaxel",
  handler: blaxelSearch,
  cost: "medium",
  latency: "medium"
}
```

---

# 5. Registry Data Structure

A good registry structure:

```ts
interface ToolDefinition {

  name: string

  capability: string

  provider: string

  handler: Function

  metadata?: {
    latency?: "low" | "medium" | "high"
    cost?: "low" | "medium" | "high"
    reliability?: number
  }

  permissions?: string[]

}
```

Registry:

```ts
class ToolRegistry {

  private tools: Map<string, ToolDefinition[]>

}
```

Keyed by capability.

---

# 6. Registering Tools

Providers automatically register tools.

Example filesystem provider:

```ts
toolRegistry.register({
  name: "filesystem.read_file",
  capability: "file.read",
  provider: "mcp",
  handler: readFile
})
```

Another:

```ts
toolRegistry.register({
  name: "filesystem.write_file",
  capability: "file.write",
  provider: "mcp",
  handler: writeFile
})
```

Blaxel provider:

```ts
toolRegistry.register({
  name: "blaxel_codegenSearch",
  capability: "repo.search",
  provider: "blaxel",
  handler: blaxelSearch
})
```

---

# 7. Capability Router

The **router selects which tool to run**.

Example:

```ts
executeCapability("repo.search", args)
```

Router:

```ts
async executeCapability(capability, args) {

  const tools = registry.getTools(capability)

  const bestTool = selectBestTool(tools)

  return bestTool.handler(args)

}
```

---

# 8. Tool Selection Strategy

Selection logic can consider:

```
latency
cost
provider health
context
permissions
```

Example:

```ts
function selectBestTool(tools) {

  return tools
    .sort((a,b) => score(b) - score(a))[0]

}
```

Score function example:

```
score = reliability - latency - cost
```

---

# 9. Context-Aware Routing

Router can consider **task context**.

Example:

```
repo.search
```

Context:

```
large repo → embeddings
small repo → ripgrep
```

Another example:

```
sandbox.execute
```

Router:

```
heavy compute → E2B
browser task → Daytona
quick code → microsandbox
```

---

# 10. Provider Adapter Layer

Providers expose tools through adapters.

Example filesystem provider:

```
providers/filesystem/provider.ts
```

Adapter:

```ts
export function registerFilesystemTools(registry) {

  registry.register({
    name: "filesystem.read_file",
    capability: "file.read",
    provider: "mcp",
    handler: readFile
  })

}
```

Nullclaw provider:

```ts
registry.register({
  name: "nullclaw_sendDiscord",
  capability: "automation.discord",
  provider: "nullclaw",
  handler: sendDiscord
})
```

---

# 11. Mapping Your Current Tools

Your current list becomes:

Filesystem:

```
filesystem.read_file → file.read
filesystem.write_file → file.write
filesystem.edit_file → file.edit
filesystem.search_files → file.search
```

Blaxel:

```
blaxel_codegenSearch → repo.search
blaxel_codegenReadFileRange → file.read
```

Nullclaw:

```
nullclaw_sendDiscord → automation.discord
nullclaw_browse → web.browse
```

Sandbox:

```
e2b_runCodexAgent → sandbox.agent
daytona_takeScreenshot → sandbox.browser
```

---

# 12. Agent Tool Exposure

Instead of giving OpenCode **40 tools**, expose **10 capabilities**.

Example schema:

```json
{
  "name": "repo.search",
  "description": "Search code in repository",
  "parameters": {
    "query": "string"
  }
}
```

Benefits:

* better tool selection
* less hallucination
* easier prompt design

---

# 13. Tool Permissions

Registry can enforce permissions.

Example:

```
sandbox.execute → restricted
automation.discord → restricted
```

Permission check:

```ts
if(!session.permissions.includes(tool.permission)) {
   throw new Error("permission denied")
}
```

---

# 14. Tool Metrics

Registry should track:

```
success rate
latency
errors
```

Example:

```ts
toolStats[tool.name].latency += duration
toolStats[tool.name].success++
```

Router uses metrics to improve selection.

---

# 15. Failure Fallback

Router should retry alternate providers.

Example:

```
repo.search
```

Flow:

```
try embeddings
if fail → blaxel
if fail → ripgrep
```

Pseudo:

```ts
for(const tool of tools) {

  try {
    return await tool.handler(args)
  }

  catch(e) {
    continue
  }

}
```

---

# 16. Parallel Tool Execution

Registry allows multi-provider execution.

Example:

```
repo.search
```

Run:

```
blaxel + embedding search
```

Then merge results.

---

# 17. Caching Layer

Certain capabilities should cache results.

Example:

```
repo.search
repo.find_symbol
```

Cache key:

```
capability + args
```

Store in Redis.

---

# 18. Example Full Flow

User prompt:

```
Find the authentication middleware and update it
```

Agent plan:

```
repo.search("authentication middleware")
```

Router:

```
capability: repo.search
```

Registry returns:

```
blaxel
embedding search
```

Router selects:

```
embedding search
```

Tool executes.

Agent receives results.

Next step:

```
file.read(auth.ts)
```

Router:

```
filesystem.read_file
```

---

# 19. Folder Structure

A clean implementation looks like:

```
core/
  capability-router.ts
  tool-registry.ts

providers/
  filesystem/
  blaxel/
  nullclaw/
  composio/
  sandbox/

agents/
  opencode-runtime
```

---

# 20. Resulting System

Your architecture becomes:

```
OpenCode Agent
     ↓
Capability Router
     ↓
Tool Registry
     ↓
Providers
     ↓
Tools
```

This design scales to **hundreds of tools without complexity explosion**.

---

Below is a **production-ready TypeScript implementation (~300 lines conceptually)** of a **Capability Router + Unified Tool Registry** designed for your stack:

* **OpenCode agent runtime**
* **MCP tools**
* **Nullclaw**
* **Composio**
* **Sandboxes (E2B, Daytona, etc.)**
* **Repo search (Blaxel)**

The goal is to replace your current pattern:

```ts
if(toolName.startsWith("filesystem_"))
```

with:

```ts
executeCapability("file.read")
```

---

# 1. Core Concepts

Three layers:

```text
Agent
 ↓
Capability Router
 ↓
Tool Registry
 ↓
Providers
 ↓
Actual Tools
```

Agents request **capabilities**, not tools.

Example:

```json
{
  "capability": "repo.search",
  "args": { "query": "authentication middleware" }
}
```

---

# 2. Capability Types

Define shared types.

`core/types.ts`

```ts
export type Capability =
  | "file.read"
  | "file.write"
  | "file.search"
  | "repo.search"
  | "repo.semantic_search"
  | "sandbox.execute"
  | "sandbox.browser"
  | "automation.discord"
  | "automation.telegram"
  | "web.browse"
  | "memory.store"
  | "memory.query"

export interface ToolMetadata {
  latency?: "low" | "medium" | "high"
  cost?: "low" | "medium" | "high"
  reliability?: number
}

export interface ToolContext {
  sessionId: string
  workspace?: string
  permissions?: string[]
}

export interface ToolDefinition {
  name: string
  capability: Capability
  provider: string
  handler: (args: any, ctx: ToolContext) => Promise<any>
  metadata?: ToolMetadata
  permissions?: string[]
}
```

---

# 3. Tool Registry

Stores all tools and indexes them by capability.

`core/tool-registry.ts`

```ts
import { ToolDefinition, Capability } from "./types"

export class ToolRegistry {

  private tools: Map<Capability, ToolDefinition[]> = new Map()

  register(tool: ToolDefinition) {

    if (!this.tools.has(tool.capability)) {
      this.tools.set(tool.capability, [])
    }

    this.tools.get(tool.capability)!.push(tool)
  }

  getTools(capability: Capability): ToolDefinition[] {
    return this.tools.get(capability) || []
  }

  listCapabilities(): Capability[] {
    return Array.from(this.tools.keys())
  }

}
```

This lets multiple providers implement the same capability.

Example:

```text
repo.search
 ├ blaxel
 ├ ripgrep
 └ embedding search
```

---

# 4. Capability Router

The router selects the best tool.

`core/capability-router.ts`

```ts
import { ToolRegistry } from "./tool-registry"
import { Capability, ToolContext, ToolDefinition } from "./types"

export class CapabilityRouter {

  constructor(private registry: ToolRegistry) {}

  async execute(
    capability: Capability,
    args: any,
    ctx: ToolContext
  ) {

    const tools = this.registry.getTools(capability)

    if (!tools.length) {
      throw new Error(`No tools for capability ${capability}`)
    }

    const sorted = this.rankTools(tools)

    for (const tool of sorted) {

      if (!this.checkPermissions(tool, ctx)) {
        continue
      }

      try {

        return await tool.handler(args, ctx)

      } catch (err) {

        console.warn(
          `[router] tool failed: ${tool.name}`
        )

      }

    }

    throw new Error(`All tools failed for ${capability}`)
  }

  private rankTools(tools: ToolDefinition[]) {

    return tools.sort((a,b) => {

      const scoreA = this.score(a)
      const scoreB = this.score(b)

      return scoreB - scoreA

    })

  }

  private score(tool: ToolDefinition) {

    let score = 0

    if(tool.metadata?.reliability)
      score += tool.metadata.reliability * 10

    if(tool.metadata?.latency === "low")
      score += 5

    if(tool.metadata?.cost === "low")
      score += 3

    return score

  }

  private checkPermissions(tool: ToolDefinition, ctx: ToolContext) {

    if(!tool.permissions) return true

    return tool.permissions.every(p =>
      ctx.permissions?.includes(p)
    )

  }

}
```

This router:

* ranks tools
* checks permissions
* retries on failure
* automatically falls back

---

# 5. Filesystem Provider

Example provider using MCP filesystem.

`providers/filesystem.ts`

```ts
import { ToolRegistry } from "../core/tool-registry"

export function registerFilesystemTools(registry: ToolRegistry) {

  registry.register({
    name: "filesystem.read_file",
    capability: "file.read",
    provider: "mcp",

    handler: async (args, ctx) => {

      const fs = await import("fs/promises")

      const path = `${ctx.workspace}/${args.path}`

      return fs.readFile(path, "utf8")

    },

    metadata: {
      latency: "low",
      cost: "low",
      reliability: 0.99
    }

  })

}
```

---

# 6. Blaxel Repo Search Provider

`providers/blaxel.ts`

```ts
export function registerBlaxelTools(registry) {

  registry.register({

    name: "blaxel_codegenSearch",
    capability: "repo.search",
    provider: "blaxel",

    handler: async (args) => {

      const res = await fetch(
        "http://blaxel/search",
        {
          method:"POST",
          body: JSON.stringify(args)
        }
      )

      return res.json()

    },

    metadata: {
      latency: "medium",
      cost: "medium",
      reliability: 0.95
    }

  })

}
```

---

# 7. Sandbox Provider

`providers/sandbox.ts`

```ts
export function registerSandboxTools(registry) {

  registry.register({

    name: "e2b_execute",
    capability: "sandbox.execute",
    provider: "e2b",

    handler: async (args) => {

      const res = await fetch(
        "http://e2b/run",
        {
          method:"POST",
          body: JSON.stringify(args)
        }
      )

      return res.json()

    },

    metadata: {
      latency: "high",
      cost: "high",
      reliability: 0.9
    }

  })

}
```

Router decides when to use it.

---

# 8. Nullclaw Provider

`providers/nullclaw.ts`

```ts
export function registerNullclawTools(registry) {

  registry.register({

    name: "nullclaw_sendDiscord",
    capability: "automation.discord",
    provider: "nullclaw",

    handler: async (args) => {

      const res = await fetch(
        "http://nullclaw/sendDiscord",
        {
          method:"POST",
          body: JSON.stringify(args)
        }
      )

      return res.json()

    }

  })

}
```

---

# 9. System Bootstrap

`core/bootstrap.ts`

```ts
import { ToolRegistry } from "./tool-registry"
import { CapabilityRouter } from "./capability-router"

import { registerFilesystemTools } from "../providers/filesystem"
import { registerBlaxelTools } from "../providers/blaxel"
import { registerSandboxTools } from "../providers/sandbox"
import { registerNullclawTools } from "../providers/nullclaw"

export function createToolSystem() {

  const registry = new ToolRegistry()

  registerFilesystemTools(registry)
  registerBlaxelTools(registry)
  registerSandboxTools(registry)
  registerNullclawTools(registry)

  const router = new CapabilityRouter(registry)

  return { registry, router }

}
```

---

# 10. Using It in OpenCode Agent Loop

Replace your existing tool execution:

```ts
executeTool(toolName,args)
```

with:

```ts
router.execute(capability,args,context)
```

Example inside `OpencodeV2Provider.runAgentLoop()`:

```ts
const result = await router.execute(
  parsed.capability,
  parsed.args,
  {
    sessionId,
    workspace,
    permissions:["workspace"]
  }
)
```

---

# 11. Exposing Tools to OpenCode

Instead of sending **40 tools**, expose **capabilities**.

Example tool schema:

```ts
const capabilities = registry.listCapabilities()

return capabilities.map(c => ({
  name: c,
  description: `Capability ${c}`
}))
```

OpenCode then requests:

```json
{
  "capability": "file.read"
}
```

Router resolves actual tool.

---

# 12. Benefits for Your Architecture

This upgrade gives you:

### Massive scalability

You can support **hundreds of tools**.

---

### Automatic fallback

Example:

```text
repo.search
 → embeddings
 → blaxel
 → ripgrep
```

---

### Provider independence

You can swap:

```text
E2B → Daytona
```

without changing agents.

---

### Better prompts

LLMs understand **capabilities** better than tool names.

---

# 13. How This Fits Your Current Architecture

Your architecture becomes:

```text
OpenCode Agent
     ↓
Capability Router
     ↓
Tool Registry
     ↓
Providers
     ↓
MCP / Composio / Nullclaw / Sandboxes
```

This replaces your current:

```text
prefix router
manual tool mapping
```

---

# 14. Next Step (Highly Recommended)

The next improvement after this system is **Tool Discovery + Auto-Registration**, where:

* MCP servers
* Composio
* sandbox APIs

**automatically register tools into your registry at runtime**.

