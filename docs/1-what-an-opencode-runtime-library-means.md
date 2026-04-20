---
id: 1-what-an-opencode-runtime-library-means
title: 1. What an “OpenCode Runtime Library” Means
aliases:
  - runtime
  - runtime.md
tags: []
layer: core
summary: "Your question touches two **important architecture layers** that are often confused:\r\n\r\n1. **OpenCode runtime library** (agent execution layer inside your app)\r\n2. **Background workers** (distributed execution layer)\r\n\r\nI'll explain both in the context of your architecture.\r\n\r\n---\r\n\r\n# 1. What an “O"
anchors:
  - Current (CLI mode)
  - Runtime Library Mode
---
Your question touches two **important architecture layers** that are often confused:

1. **OpenCode runtime library** (agent execution layer inside your app)
2. **Background workers** (distributed execution layer)

I'll explain both in the context of your architecture.

---

# 1. What an “OpenCode Runtime Library” Means

Right now your system runs OpenCode like this:

```
npx opencode chat --json < prompt.json
```

inside `OpencodeV2Provider.runAgentLoop()`.

That means your architecture currently looks like:

```
NextJS
   ↓
spawn child process
   ↓
OpenCode CLI
   ↓
NDJSON output
```

This works, but it has drawbacks:

* slow startup (CLI boot every run)
* process spawning overhead
* difficult session reuse
* hard to scale workers
* difficult debugging

A **runtime library** replaces the CLI process with a **direct programmatic API**.

Instead of spawning:

```ts
spawn("npx", ["opencode","chat","--json"])
```

You would run:

```ts
import { runAgent } from "@opencode/runtime"

await runAgent({
  prompt,
  tools,
  stream: true
})
```

So OpenCode becomes **a library inside your worker**, not a subprocess.

---

# 2. Current Execution vs Runtime Library

## Current (CLI mode)

```
NextJS route
     ↓
OpencodeV2Provider
     ↓
spawn process
     ↓
npx opencode chat
     ↓
NDJSON parsing
```

Problems:

* process management
* memory duplication
* hard scaling
* fragile IO streaming

---

## Runtime Library Mode

```
NextJS
     ↓
Gateway
     ↓
Worker
     ↓
OpenCode runtime (JS library)
     ↓
Tools
```

Benefits:

* faster
* better error handling
* easier debugging
* persistent sessions
* lower CPU usage

---

# 3. What the Runtime Library Actually Does

The runtime library is essentially:

```
OpenCode CLI
    ↓
extracted into
    ↓
Agent Runtime Engine
```

Responsibilities:

```
Agent loop
tool calling
memory
planning
LLM calls
token streaming
```

Example internal loop:

```
prompt
  ↓
LLM
  ↓
tool call?
  ↓ yes
execute tool
  ↓
append result
  ↓
LLM again
```

That loop currently lives **inside the CLI**.

A runtime library lets you run it **inside your worker service**.

---

# 4. Minimal Runtime Library Interface

Example API:

```ts
import { AgentRuntime } from "@opencode/runtime"

const runtime = new AgentRuntime({
  model: "anthropic/claude-sonnet",
  tools: toolRegistry
})

const result = await runtime.run({
  prompt: userPrompt,
  stream: onToken
})
```

No CLI.

---

# 5. Why Runtime Libraries Matter for Workers

Your architecture already includes:

```
gateway
worker
redis
```

Workers should **not spawn CLI processes repeatedly**.

Instead they should run:

```
long-lived runtime
```

Example worker lifecycle:

```
worker start
   ↓
load models
load tools
initialize runtime
   ↓
process jobs
```

Much faster.

---

# 6. Background Worker Architecture

Your docker architecture:

```
app
gateway
worker
redis
mcp
nullclaw
```

This is good.

Workers should process **jobs** from Redis.

---

# 7. Recommended Worker Flow

```
User request
   ↓
NextJS API
   ↓
Gateway
   ↓
Redis queue
   ↓
Worker
   ↓
Agent runtime
   ↓
Tools
```

Workers run the **actual agent loop**.

---

# 8. Example Worker Implementation

Worker service:

```ts
import { Worker } from "bullmq"

const worker = new Worker(
  "agent-jobs",
  async job => {

    const { prompt, sessionId } = job.data

    const result = await runtime.run({
      prompt,
      sessionId
    })

    return result

  }
)
```

Workers subscribe to Redis queue.

---

# 9. Job Queue Design

Queues separate different workloads.

Example:

```
agent-execution
sandbox-execution
repo-indexing
automation
```

Example:

```
agent-execution
    ↓
worker-agent
```

```
sandbox-execution
    ↓
worker-sandbox
```

This avoids heavy tasks blocking the agent.

---

# 10. Streaming With Workers

Streaming tokens from workers to clients requires **event forwarding**.

Flow:

```
Worker
   ↓
Redis PubSub
   ↓
Gateway
   ↓
SSE
   ↓
Client
```

Example worker event:

```ts
pub.publish(
  `session:${sessionId}`,
  JSON.stringify({
    type: "token",
    value: chunk
  })
)
```

Gateway forwards to SSE.

---

# 11. Worker Scaling

Because workers are stateless, you can scale horizontally.

```
worker-1
worker-2
worker-3
worker-4
```

Redis distributes jobs.

Benefits:

* parallel execution
* fault tolerance
* autoscaling

---

# 12. Worker Types

Large systems split workers by job type.

Example:

```
agent-worker
sandbox-worker
repo-worker
automation-worker
```

Example responsibilities:

Agent worker:

```
OpenCode runtime
LLM
tool routing
```

Sandbox worker:

```
E2B
Daytona
code execution
```

Repo worker:

```
code indexing
embeddings
search
```

Automation worker:

```
Discord
Telegram
Zapier
```

---

# 13. Worker Memory Model

Workers should avoid heavy per-job initialization.

Bad:

```
spawn runtime every request
```

Good:

```
create runtime once
reuse across jobs
```

Example:

```ts
const runtime = new AgentRuntime(...)
```

Then:

```
worker processes 1000+ jobs
```

---

# 14. Session Handling

Sessions should be stored in Redis or DB.

Example session state:

```
messages
memory
workspace
permissions
```

Worker loads session:

```
load session
run agent
save session
```

---

# 15. Crash Recovery

If a worker crashes:

```
Redis queue
   ↓
job reprocessed
```

BullMQ supports retries.

Example:

```ts
attempts: 3
backoff: 5000
```

---

# 16. Handling Long Agent Tasks

Agents sometimes run **many steps**.

You can checkpoint progress:

```
step 1
save state
step 2
save state
```

If crash occurs:

```
resume from step
```

---

# 17. Worker Monitoring

Important metrics:

```
queue length
worker latency
job duration
tool failures
```

Tools:

* Prometheus
* Grafana
* BullMQ dashboard

---

# 18. Ideal Architecture for Your System

Your architecture becomes:

```
NextJS
   ↓
Gateway
   ↓
Redis Queue
   ↓
Agent Workers
   ↓
OpenCode Runtime
   ↓
Capability Router
   ↓
Tool Registry
   ↓
Providers
```

---

# 19. How This Improves Your Current System

You eliminate:

```
spawn npx opencode
NDJSON parsing
CLI overhead
```

and replace it with:

```
native runtime
queue processing
horizontal scaling
```

---

# 20. Biggest Practical Benefit

With workers you can handle:

```
1000+ concurrent agents
```

without blocking NextJS.

---

✅ If you'd like, I can also show something extremely useful for your stack:

**a complete production architecture for an "Agent Gateway + Worker Cluster" used by systems like Cursor, Devin, and Claude Code.**

It will show:

* session orchestration
* distributed agent loops
* sandbox orchestration
* tool routing at scale.
