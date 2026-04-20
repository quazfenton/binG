---
id: 1-biggest-current-architectural-risk
title: 1. Biggest Current Architectural Risk
aliases:
  - architectureUpdate
  - architectureUpdate.md
tags: []
layer: core
summary: "* sandbox lifecycle\r\n* execution isolation\r\n* agent ↔ sandbox coupling\r\n* monitoring feedback\r\n* provider routing\r\n* worker orchestration\r\n\r\nI'll walk through **practical improvements** you can integrate **without rewriting your architecture**.\r\n\r\n---\r\n\r\n# 1. Biggest Current Architectural Risk"
anchors:
  - New Layer
  - Command filtering
  - Network sandboxing
  - File system isolation
  - 1️⃣ Sandbox Orchestrator Layer
  - 2️⃣ Sandbox Warm Pools
  - 3️⃣ Automatic Risk Escalation
  - High Level
  - 1. User prompt
  - 2. Chat API      DONE
  - 3. Agent Gateway
  - 4. Agent Worker
  - 5. OpenCode Engine
  - Replace
  - 1️⃣ Persistent OpenCode workers
  - 2️⃣ Redis job queue
  - 3️⃣ Repo search index
  - 4️⃣ Planner agent
  - 5️⃣ Background workers
---


* sandbox lifecycle
* execution isolation
* agent ↔ sandbox coupling
* monitoring feedback
* provider routing
* worker orchestration

I'll walk through **practical improvements** you can integrate **without rewriting your architecture**.

---

# 1. Biggest Current Architectural Risk

Right now:

```text
OpenCode agent
     ↓
MCP tools
     ↓
Sandbox providers
```

The **agent decides when to use sandboxes indirectly via tools**.

Problem:

Agents often **misjudge when sandbox execution is required**.

Example failures:

```
npm install inside host
heavy build on main server
infinite bash loop
fork bomb
memory leak
```

Your system **assumes the agent behaves safely**.

Production systems **never rely on this assumption**.

---

# 2. Introduce a Sandbox Orchestrator Layer

Right now you have:

```
provider-router
preview-offloader
resource-monitor
```

But they are **not unified**.

You need a **single orchestrator layer**.

### New Layer

```
Sandbox Orchestrator
```

Architecture:

```
Agent
 ↓
Execution Policy Engine
 ↓
Sandbox Orchestrator
 ↓
Provider Router
 ↓
Sandbox Provider
```

Responsibilities:

```
decide sandbox vs local
choose provider
manage lifecycle
monitor resources
migrate sandboxes
terminate runaway jobs
```

---

# 3. Replace `cloudSandbox` Boolean With Execution Policies

Right now:

```ts
cloudSandbox: true/false
```

This is too coarse.

Replace with:

```ts
executionPolicy
```

Example:

```ts
type ExecutionPolicy =
  | "local-safe"
  | "sandbox-required"
  | "sandbox-preferred"
  | "sandbox-heavy"
  | "persistent-sandbox"
```

Example usage:

```ts
session = getOrCreateSession({
  executionPolicy: "sandbox-required"
})
```

This lets your system **automatically escalate**.

---

# 4. Automatic Sandbox Escalation

Detect risky commands **before execution**.

Example:

```ts
const RISKY_PATTERNS = [
  "npm install",
  "pip install",
  "docker",
  "git clone",
  "curl",
  "wget",
  "bash",
  "node server",
  "python train",
]
```

Before tool execution:

```ts
if (isRiskyCommand(command)) {
   moveToSandbox()
}
```

Escalation flow:

```
local execution
     ↓
risk detected
     ↓
sandbox spawn
     ↓
resume execution
```

This is how **Claude Code and Cursor agents protect hosts**.

---

# 5. Sandbox Warm Pool (Huge Performance Boost)

Currently each sandbox likely:

```
create
install deps
start runtime
execute
destroy
```

This is slow.

Introduce **sandbox warm pools**.

Architecture:

```
Warm Sandbox Pool
   ├ node-runtime
   ├ python-runtime
   ├ fullstack-runtime
```

Prewarm containers:

```
node
python
nextjs
react
```

Example pool:

```ts
class SandboxPool {

  pools = {
    node: [],
    python: [],
    fullstack: []
  }

}
```

Sandbox creation becomes:

```
spawn → 10s
reuse → 300ms
```

---

# 6. Sandbox Snapshot System

Your providers like **sprites** support snapshots.

Use them.

Example lifecycle:

```
create sandbox
install deps
snapshot
```

Future tasks:

```
restore snapshot
```

This avoids:

```
npm install
pip install
apt install
```

Every run.

---

# 7. Detect Infinite Agent Loops

Your system limits:

```
maxSteps = 15
```

But that's not enough.

Add **loop detection**.

Example:

```ts
const fingerprint = hash(toolName + JSON.stringify(args))
```

Track history:

```
same tool called repeatedly
same args
```

If repeated >3 times:

```
terminate agent
```

---

# 8. NDJSON Parsing Failpoint

Your NDJSON loop is fragile:

```ts
const parsed = JSON.parse(line)
```

If a line is partial:

```
stream chunk
```

You get:

```
Unexpected end of JSON input
```

Use **stream parser** instead.

Example:

```ts
import ndjson from "ndjson"

process.stdout.pipe(ndjson.parse())
```

This avoids broken parsing.

---

# 9. Timeout Escalation Strategy

Your code currently:

```
executeLocalCommand(timeout)
```

Better approach:

```
stage 1: soft timeout
stage 2: sandbox escalation
stage 3: termination
```

Example:

```
10s → warn
30s → sandbox migrate
60s → kill process
```

---

# 10. Sandbox Migration (Advanced but Powerful)

If local execution becomes heavy:

```
move execution to sandbox
```

Example flow:

```
agent running locally
     ↓
resource spike
     ↓
snapshot workspace
     ↓
spawn sandbox
     ↓
restore workspace
     ↓
continue execution
```

This prevents:

```
server overload
```

---

# 11. Unified Resource Telemetry

Right now:

```
resource-monitor
```

runs independently.

Instead feed metrics into **provider router scoring**.

Example scoring improvement:

Current:

```
task type match
services match
quota
```

Add:

```
provider load
latency
failure rate
```

Example scoring:

```
score =
  task_match * 0.4 +
  service_match * 0.3 +
  latency_score * 0.1 +
  load_score * 0.1 +
  reliability_score * 0.1
```

---

# 12. Provider Health Prediction

Instead of reacting to failures:

Predict failures.

Example:

```
last 10 calls
failure rate
```

If failure rate >30%:

```
deprioritize provider
```

---

# 13. Sandbox Garbage Collection

You currently have:

```
30 minute TTL
cleanup every 5 minutes
```

Better lifecycle:

```
active
idle
hibernated
terminated
```

Example:

```
idle 5 min → suspend
idle 30 min → terminate
```

This saves **cloud cost**.

---

# 14. Preview Offloader Optimization

Your preview decision tree is good but static.

Add **heuristics**:

Detect:

```
node_modules size
build logs
memory spikes
```

Auto-offload if:

```
build > 20s
memory > 1GB
```

---

# 15. Security Failpoints

Current risks:

```
bash injection
host file access
network abuse
```

Mitigations:

### Command filtering

```
rm -rf /
fork bombs
crypto miners
```

### Network sandboxing

Block:

```
internal metadata endpoints
cloud APIs
```

### File system isolation

Only allow:

```
workspace/*
```

---

# 16. Worker Integration (Critical)

Your sandbox operations should run on **separate workers**.

Architecture:

```
agent-worker
sandbox-worker
preview-worker
monitor-worker
```

Example:

```
agent requests sandbox
     ↓
sandbox-worker creates container
     ↓
returns handle
```

This prevents:

```
NextJS blocking
```

---

# 17. Provider Router Improvement

Your scoring is good.

But you should include **dynamic signals**.

Add:

```
provider latency
active sandbox count
CPU load
queue depth
```

Example scoring adjustment:

```
score -= activeSandboxes * 2
```

---

# 18. Observability (Missing)

Add tracing.

Each request should track:

```
agent steps
tool calls
sandbox creation
resource usage
provider routing
```

Use:

```
OpenTelemetry
```

Trace example:

```
user request
   ↓
agent step
   ↓
tool call
   ↓
sandbox creation
   ↓
preview
```

---

# 19. Unified Execution Graph

Your system currently has **fragmented control paths**.

Better model:

```
Execution Graph
```

Nodes:

```
agent step
tool call
sandbox action
preview task
```

Edges represent:

```
dependency
```

This enables:

```
parallel execution
retry
failure recovery
```

---

# 20. Final Improved Architecture

Your improved architecture should look like:

```
User Request
      ↓
Task Router
      ↓
Agent Executor
      ↓
Execution Policy Engine
      ↓
Sandbox Orchestrator
      ↓
Provider Router
      ↓
Sandbox Providers
```

Supporting systems:

```
Resource Monitor
Sandbox Pool
Snapshot Manager
Telemetry System
Worker Queue
```

---

# 21. The Three Most Important Improvements

If you only implement **three changes**, choose these:

### 1️⃣ Sandbox Orchestrator Layer

Unify sandbox lifecycle.

---

### 2️⃣ Sandbox Warm Pools

Huge latency reduction.

---

### 3️⃣ Automatic Risk Escalation

Prevent host crashes.

---

# 22. One More Major Future Upgrade

Your system is **very close** to supporting:

```
multi-agent orchestration
```

Example:

```
planner agent
coder agent
tester agent
reviewer agent
```



 The main problems are:

2. **Tight coupling of agent loop + tools + VFS**
3. **No message bus / task queue**
4. **No isolation between agents**
5. **NextJS API route doing orchestration**

For a production-grade **OpenCode-powered agent engine**, the best architecture is to **separate the LLM app, the agent engine, and the tool runtime**.

I'll show the **optimal architecture** used in modern agent systems.

---

# Best Architecture for OpenCode Engine + NextJS Chat

## High Level

```
                ┌─────────────────────┐
                │     NextJS App      │
                │  (UI + API/chat)   │
                └──────────┬──────────┘
                           │
                           │ HTTP / SSE
                           ▼
                ┌─────────────────────┐
                │   Agent Gateway     │
                │ (Session Manager)   │
                └──────────┬──────────┘
                           │
                           │ gRPC / Redis Queue
                           ▼
                ┌─────────────────────┐
                │   Agent Workers     │
                │  (OpenCode Engine)  │
                └──────────┬──────────┘
                           │
        ┌──────────────────┼───────────────────┐
        ▼                  ▼                   ▼
  MCP Tool Server    Nullclaw Container   Sandbox Pool
  (filesystem/VFS)   (automation)         (OpenSandbox)
```

---

# Key Design Principle

**NextJS should NOT run the agent loop.**

NextJS should only:

```
receive prompt
↓
create agent job
↓
stream events
```

The **agent engine runs in a separate service**.

---

# Ideal Docker Architecture  DONE

```
docker-compose

services:

  nextjs
    ports: 3000
    depends_on:
      - agent-gateway

  agent-gateway
    handles sessions + SSE
    forwards jobs to workers

  agent-worker
    runs OpenCode engine loop
    executes tools

  mcp-server
    filesystem + memory tools

  nullclaw
    sandboxed automation tools

  redis
    job queue + streaming pubsub

  opensandbox
    isolated code execution
```

---

# Request Flow (Improved)   DONE

### 1. User prompt

```
User → NextJS UI
```

---

### 2. Chat API      DONE

```
/api/chat
```

NextJS does **only orchestration**.  

```
POST /api/chat
  ↓
create agent job
  ↓
POST → agent-gateway
```

---

### 3. Agent Gateway

Responsibilities:

* session management
* streaming events
* tool routing metadata
* agent lifecycle

```
gateway.createJob(prompt, session)
        ↓
redis queue
```

---

### 4. Agent Worker

Workers pull tasks.

```
worker loop

while(true)
  job = redis.pop()

  runAgentLoop(job)
```

---

### 5. OpenCode Engine

Instead of spawning CLI per prompt:

**run OpenCode as a persistent engine**

```
class OpenCodeEngine {

  async runLoop(prompt) {

    const stream = opencode.run({
       model,
       tools,
       messages
    })

    for await (event of stream) {

      if(event.type === "text")
         publishToken()

      if(event.type === "tool")
         runTool()

    }

  }
}
```

---

# Why Persistent Engine > CLI

Your current method:

```
spawn
npx opencode chat
parse stdout
kill process
```

Problems:

```
slow
high memory
bad scaling
```

Better:

```
import { runAgent } from "opencode"
```

or run a **long-lived opencode worker**.

---

# Tool Execution Architecture

Instead of direct tool calls:

```
tool_router
```

Example:

```
toolRouter.execute(name,args)

switch:

filesystem_* → MCP
nullclaw_*   → nullclaw
sandbox_*    → sandbox pool
memory_*     → memory server
```

---

# File System Architecture

Important for coding agents.

Use **three layers**:

```
Agent Workspace
      ↓
Virtual FS
      ↓
Real FS
```

```
/workspaces/{sessionId}
```

Workers operate here.

After execution:

```
diff → send to client
```

---

# VFS Sync (Better)

Instead of syncing entire workspace:

```
git-style patch diff
```

Example:

```
changed_files = git diff
```

Send:

```
{
 files: [
  { path:"app/page.tsx", diff:"..." }
 ]
}
```

Much faster.

---

# Streaming Architecture

Use **Redis PubSub** or **NATS**.

Worker publishes:

```
agent:event:{sessionId}
```

NextJS streams via SSE.

```
Worker → Redis
Redis → Gateway
Gateway → Client
```

This allows **horizontal scaling**.

---

# Sandbox Execution

Instead of conditionally creating cloud sandboxes:

Run **sandbox pool**.

```
sandbox-manager

prewarm:
  5 containers
```

Worker requests sandbox:

```
sandbox.allocate()
```

Much faster.

---

# Nullclaw Integration

Keep exactly what you planned:

```
nullclaw container
```

Tool call:

```
nullclaw_browser
nullclaw_discord
nullclaw_telegram
```

Worker sends HTTP request.

---

# Recommended Project Structure

```
repo/

apps/
   nextjs-app

services/
   agent-gateway
   agent-worker

packages/
   opencode-engine
   tool-router
   vfs
   agent-protocol

infra/
   docker-compose
```

---

# Agent Worker Internals

```
AgentWorker

 job
  ↓
 session manager
  ↓
 OpenCode engine
  ↓
 tool router
  ↓
 tool execution
  ↓
 event streaming
```

---

# Optimal Tool Router

```
tool-router.ts
```

```
executeTool(name,args){

 if(name.startsWith("filesystem"))
   return mcp.execute()

 if(name.startsWith("nullclaw"))
   return nullclaw.execute()

 if(name.startsWith("sandbox"))
   return sandbox.execute()

 if(name.startsWith("memory"))
   return memory.execute()

}
```

---

# Biggest Upgrade You Should Make

### Replace

```
npx opencode chat
```

with

```
opencode runtime library
```

or a **persistent OpenCode server**.

---

# Final Recommended Architecture

```
NextJS
   │
   │ HTTP/SSE
   ▼
Agent Gateway
   │
   │ Redis Queue
   ▼
Agent Workers (OpenCode)
   │
   ├ MCP Tools
   ├ Nullclaw
   ├ Sandbox Pool
   └ VFS Workspace
```

---

# Performance Benefits

| Improvement        | Result           |
| ------------------ | ---------------- |
| Persistent workers | 10x faster       |
| Redis queue        | horizontal scale |
| Sandbox pool       | instant exec     |
| VFS diff           | less bandwidth   |
| Decoupled NextJS   | stability        |

---

# If Built Properly This Can Handle

```
1000+ agents
parallel coding tasks
large repos
multi-user
```

This is **basically the architecture used by**:

* Cursor
* Devin-style agents
* OpenDevin
* Cognition stacks

---

I'll show you the **advanced architecture used by modern coding agents (Cursor / Devin-style systems)** and how to adapt it to your **NextJS + OpenCode + Nullclaw + VFS** stack.

Your current design is **single-agent sequential execution**. Modern coding agents are **multi-stage task systems**.

The upgrade adds:

* **Planner agent**
* **Executor agents**
* **Background workers**
* **Repo indexing**
* **Long-running task graphs**
* **parallel tool execution**

This dramatically improves **large coding tasks**.

---

# Advanced Coding Agent Architecture

```text
                    ┌─────────────────────┐
                    │      NextJS UI      │
                    │  Chat + File Tree   │
                    └──────────┬──────────┘
                               │
                               │ HTTP / SSE
                               ▼
                    ┌─────────────────────┐
                    │    Agent Gateway    │
                    │ Session + Streaming │
                    └──────────┬──────────┘
                               │
                     Redis / Task Queue
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Planner Worker       Executor Worker       Background Worker
  (task decomposition)  (OpenCode engine)     (indexing/search)
          │                    │                    │
          │                    │                    │
          ▼                    ▼                    ▼
     Task Graph           Tool Router          Repo Index
                           │  │  │
                           │  │  │
                           ▼  ▼  ▼
                     MCP Tools  Nullclaw  Sandbox Pool
```

---

# Why This Is Better

Instead of:

```
Prompt → agent loop → tools
```

You get:

```
Prompt
 ↓
Planner
 ↓
Task Graph
 ↓
Parallel Executors
 ↓
Results merged
```

This is **10-50x better for coding tasks**.

---

# 1️⃣ Planner Agent

The planner **breaks a request into steps**.

Example user prompt:

```
Build authentication with NextAuth
```

Planner generates:

```json
{
  "tasks": [
    {
      "id": 1,
      "type": "search",
      "goal": "Find auth files"
    },
    {
      "id": 2,
      "type": "edit",
      "goal": "Create auth config"
    },
    {
      "id": 3,
      "type": "edit",
      "goal": "Add login UI"
    },
    {
      "id": 4,
      "type": "test",
      "goal": "Verify auth flow"
    }
  ]
}
```

---

# 2️⃣ Task Graph

Instead of a list, tasks become a **dependency graph**.

Example:

```text
Task 1 (search repo)
      │
      ▼
Task 2 (create auth config)
      │
      ▼
Task 3 (edit UI)
      │
      ▼
Task 4 (run tests)
```

Workers can execute tasks **in parallel when possible**.

---

# 3️⃣ Executor Agents

Each task runs through an **OpenCode agent loop**.

Example:

```
Executor receives:

Task: Edit file
Goal: Create NextAuth config
```

Then runs your existing loop:

```
OpenCode
 ↓
tool calls
 ↓
filesystem edits
 ↓
result
```

Your **current OpenCode integration works perfectly here**.

---

# 4️⃣ Background Workers

Background workers run **non-interactive tasks**.

Examples:

```
repo indexing
embedding updates
file watchers
dependency analysis
git operations
```

This makes code agents **much smarter**.

---

# 5️⃣ Repository Index

Add a **code search index**.

Instead of scanning the filesystem each prompt:

```
repo → embeddings
```

Stored in:

```
Qdrant
Weaviate
or SQLite
```

Agent can run:

```
search_code("authentication")
```

This is **massively faster**.

---

# 6️⃣ Tool Router

Your existing tool router is good, but expand it.

```
tool_router
```

```ts
switch (tool) {

 case "filesystem.*":
   return mcp.filesystem()

 case "nullclaw.*":
   return nullclaw()

 case "sandbox.*":
   return sandbox()

 case "code.search":
   return repoIndex.search()

 case "git.*":
   return gitTools()

}
```

---

# 7️⃣ Workspace Model

Use **one workspace per session**.

```
/workspaces/
   session-123/
      repo/
```

Executors operate here.

VFS mirrors it to UI.

---

# 8️⃣ Event Streaming

Events become richer.

```
token
tool_call
file_change
task_start
task_complete
agent_step
error
done
```

The UI can show **agent reasoning timeline**.

---

# 9️⃣ Docker Architecture (Recommended)

```yaml
version: "3"

services:

  nextjs:
    build: ./apps/web
    ports:
      - 3000:3000

  gateway:
    build: ./services/agent-gateway

  planner:
    build: ./services/planner-worker

  executor:
    build: ./services/executor-worker
    scale: 3

  background:
    build: ./services/background-worker

  mcp:
    build: ./services/mcp-server
    ports:
      - 8888:8888

  nullclaw:
    image: opensandbox/nullclaw

  sandbox:
    image: opensandbox/microsandbox

  redis:
    image: redis

  qdrant:
    image: qdrant/qdrant
```

---

# 10️⃣ Executor Worker (OpenCode)

Your OpenCode loop becomes:

```ts
async function runTask(task) {

 const agent = new OpenCodeAgent({
   tools: toolRouter
 })

 for await (event of agent.run(task.prompt)) {

   publishEvent(event)

 }
}
```

---

# 11️⃣ Long Running Agents

Important upgrade.

Agents can run **minutes or hours**.

Example:

```
"Refactor this entire repo"
```

Instead of blocking HTTP:

```
jobId returned
```

Client subscribes:

```
/api/jobs/:id/stream
```

---

# 12️⃣ Memory System

Add **long-term memory**.

```
memory entities
relations
observations
```

Example:

```
Project uses NextJS
Uses Prisma
Auth uses Clerk
```

Agents use this as context.

---

# 13️⃣ Git Integration

Agents should commit automatically.

Example tools:

```
git_commit
git_diff
git_branch
git_checkout
```

This prevents destructive edits.

---

# 14️⃣ Parallel Tool Execution

Instead of sequential tools:

```
search files
read files
analyze files
```

Can run simultaneously.

---

# 15️⃣ Observability

Add:

```
OpenTelemetry
Langfuse
Helicone
```

To monitor agent loops.

---

# Final "Full Power" Architecture

```
NextJS UI
     │
     ▼
Agent Gateway
     │
     ▼
Task Planner
     │
     ▼
Task Graph
     │
 ┌───┼───────────────┐
 ▼   ▼               ▼
Executor Executor   Executor
(OpenCode)          (OpenCode)
     │
     ▼
Tool Router
     │
 ┌───┼───────────────┬────────────┐
 ▼   ▼               ▼            ▼
MCP FS   Nullclaw   Sandbox    Repo Index
```

---

# Biggest Improvements You Should Implement

### 1️⃣ Persistent OpenCode workers

Not CLI spawn.

---

### 2️⃣ Redis job queue

For scaling.

---

### 3️⃣ Repo search index

Huge performance gain.

---

### 4️⃣ Planner agent

Much smarter coding.

---

### 5️⃣ Background workers

For indexing + memory.

---














The goal is to evolve your current architecture into a **Distributed Agent Runtime + Sandbox Mesh**.

This lets your system support:

⚡ thousands of concurrent agents
⚡ long-running tasks (hours)
⚡ multi-agent collaboration
⚡ resilient execution

---

# 1. Current Architecture (Simplified)

Your architecture today:

```
User
 ↓
NextJS API
 ↓
OpenCode CLI
 ↓
MCP tools
 ↓
Sandbox providers
```

Problems at scale:

• CLI spawning overhead
• no persistent runtime
• sandbox lifecycle fragmented
• agent state tightly coupled to request lifecycle

---

# 2. Target Architecture

The next step is a **distributed runtime layer**.

```
Client
 ↓
API Gateway
 ↓
Agent Orchestrator
 ↓
Task Queue
 ↓
Agent Workers
 ↓
Sandbox Mesh
 ↓
Tool Providers
```

This separates:

* orchestration
* execution
* environment
* tools

---

# 3. Agent Runtime Layer

Instead of:

```
spawn opencode CLI
```

Workers run a **long-lived runtime engine**.

Example runtime loop:

```
AgentRuntime
   ↓
LLM step
   ↓
tool call
   ↓
environment execution
   ↓
memory update
   ↓
next step
```

Each runtime can process **many tasks sequentially** without restarting.

Benefits:

• no CLI overhead
• lower latency
• easier state recovery

---

# 4. Agent Orchestrator

The orchestrator decides:

• which worker runs the agent
• which sandbox environment to use
• how to recover failures

Architecture:

```
Agent Request
      ↓
Orchestrator
      ↓
Execution Plan
      ↓
Worker assignment
```

Responsibilities:

```
session state
agent planning
worker scheduling
sandbox allocation
retry logic
```

---

# 5. Sandbox Mesh

Instead of individual sandbox providers, create a **sandbox mesh**.

```
Agent Worker
     ↓
Sandbox Gateway
     ↓
Provider Mesh
      ├ E2B
      ├ Daytona
      ├ Firecracker
      └ Docker
```

The gateway hides provider complexity.

Workers simply request:

```
createSandbox(type="node")
execute(command)
snapshot()
destroy()
```

---

# 6. Sandbox Warm Pool

Sandbox creation is expensive.

Instead use **pre-warmed pools**.

```
Warm Pool
  ├ Node runtime
  ├ Python runtime
  ├ Fullstack runtime
```

Lifecycle:

```
prewarm
   ↓
assign to task
   ↓
reset
   ↓
return to pool
```

Creation time:

```
cold sandbox   → ~10s
warm sandbox   → ~200ms
```

Huge speed improvement.

---

# 7. Snapshot-Based Environments

Most agent tasks install dependencies.

Use snapshots.

Example flow:

```
sandbox start
npm install
snapshot environment
```

Future tasks:

```
restore snapshot
```

This avoids repeating:

```
pip install
npm install
apt install
```

--

# 8. Multi-Agent Task Graph
SKIP FOR NOW

Advanced agent systems run **multiple cooperating agents**.

Example task graph:

```
planner
  ↓
coder
  ↓
tester
  ↓
reviewer
```

Each agent may run in its **own sandbox**.

Graph execution:

```
Agent DAG
 ├ planner
 ├ coder
 ├ tester
 └ reviewer
```

Advantages:

• parallelism
• modular tasks
• easier recovery

---

# 9. Execution Graph Engine

Instead of linear steps:

```
step 1
step 2
step 3
```

Represent execution as a **graph**.

Example:

```
Node A: plan
Node B: search repo
Node C: modify files
Node D: run tests
```

Edges represent dependencies.

Benefits:

• retry failed nodes
• parallel execution
• better observability

---

# 10. Persistent Agent Sessions

Your system already uses sessions, but distributed systems require **persistent storage**.

Agent state should include:

```
messages
memory entities
workspace state
tool history
execution graph
```

Stored in:

```
Redis
Postgres
object storage
```

Workers reload session state before execution.

---

# 11. Distributed Streaming

Workers stream tokens using a **pub/sub channel**.

Flow:

```
Worker
 ↓
Redis PubSub
 ↓
Gateway
 ↓
SSE/WebSocket
 ↓
Client
```

This allows streaming even if workers are remote.

---

# 12. Worker Specialization

Large systems use **different worker types**.

Example:

```
agent-worker
sandbox-worker
indexing-worker
automation-worker
```

Responsibilities:

Agent worker

```
LLM calls
tool orchestration
agent planning
```

Sandbox worker

```
container lifecycle
execution
resource isolation
```

Indexing worker

```
code search
embedding
repository indexing
```

---

# 13. Tool Capability Router

Instead of static prefixes:

```
nullclaw_
filesystem_
memory_
```

Use capability discovery.

Example:

```
capability: browse_web
capability: edit_files
capability: execute_code
```

Agent runtime selects tools dynamically.

---

# 14. Resource-Aware Scheduling

The orchestrator should consider:

```
CPU load
memory
sandbox capacity
provider latency
worker queue depth
```

Scheduling algorithm:

```
score = capabilityMatch
      + workerLoadScore
      + sandboxAvailability
```

This avoids overload.

---

# 15. Failure Recovery

Agent systems must survive crashes.

Recovery strategies:

```
checkpoint execution graph
store tool results
persist workspace
```

If worker crashes:

```
reload checkpoint
resume execution
```

---

# 16. Security Isolation

Sandbox mesh protects:

```
host filesystem
internal network
cloud metadata
```

Use:

```
network policies
filesystem isolation
resource quotas
```

---

# 17. Observability Layer

Track every execution step.

Example telemetry:

```
agent step latency
tool invocation
sandbox lifecycle
provider routing
token usage
```

Tools:

```
OpenTelemetry
Prometheus
Grafana
```

Observability is critical for debugging agent behavior.

---

# 18. Distributed Workspace Storage

Agents often modify files.

Instead of local disk:

```
workspace stored in object storage
```

Workers sync workspace when needed.

Benefits:

```
portable sandboxes
easy recovery
parallel workers
```

---

# 19. Scaling Model

The system scales horizontally.

```
Gateway nodes
Agent workers
Sandbox workers
Redis cluster
```

Add more workers as demand increases.

---

# 20. Final Distributed Architecture

Complete architecture:

```
Client
 ↓
API Gateway
 ↓
Agent Orchestrator
 ↓
Task Queue
 ↓
Agent Worker Cluster
 ↓
Sandbox Mesh
 ↓
Tool Providers
 ↓
External Services
```

Supporting infrastructure:

```
Redis (queues + pubsub)
Postgres (sessions)
Object Storage (workspaces)
Telemetry (metrics + tracing)
```

---

# 21. What This Enables

Your system can now support:

```
long-running coding agents
multi-agent collaboration
distributed execution
sandbox migration
thousands of concurrent sessions
```



