---
id: 1-hierarchical-agent-architecture
title: 1. Hierarchical Agent Architecture
aliases:
  - agentLoop
  - agentLoop.md
tags:
  - agent
  - spawn
  - architecture
layer: core
summary: "what advanced coding systems use internally: **Hierarchical Agent Systems (HAS)** with **recursive task trees, autonomous debugging loops, and specialized agents**.\r\n\r\nThis solves the biggest limitation of single-agent systems: **context and reasoning collapse on large tasks**.\r\n\r\nBelow is the archi"
anchors:
  - Supervisor Agent
  - Planner Agent
  - Executor Agents
  - Debugger Agent
  - Verifier Agent
---
what advanced coding systems use internally: **Hierarchical Agent Systems (HAS)** with **recursive task trees, autonomous debugging loops, and specialized agents**.

This solves the biggest limitation of single-agent systems: **context and reasoning collapse on large tasks**.

Below is the architecture that fits **your stack (OpenCode + Mastra + CrewAI + Vercel AI SDK + Composio + multiple sandboxes)**.

---

# 1. Hierarchical Agent Architecture

Instead of one agent doing everything:

```
User Prompt
   ↓
Single Agent
   ↓
Tools
```

You build **layers of agents**.

```
User Prompt
     ↓
Supervisor Agent
     ↓
Planner Agent
     ↓
Task Tree
     ↓
Executor Agents
     ↓
Debugger Agent
     ↓
Verifier Agent
```

Each agent has a **specialized role**.

---

# 2. Agent Roles

### Supervisor Agent

The top-level orchestrator.

Responsibilities:

* manages the conversation
* decides when to spawn agents
* merges results
* handles retries

Example:

```
User: "Refactor authentication system"
```

Supervisor decides:

```
spawn planner
spawn code agent
spawn debugger
```

---

### Planner Agent

Creates a **task graph**.

Example output:

```json
{
 "tasks":[
  {"id":1,"goal":"Locate authentication code"},
  {"id":2,"goal":"Analyze auth flow"},
  {"id":3,"goal":"Refactor auth module"},
  {"id":4,"goal":"Update UI login"},
  {"id":5,"goal":"Run tests"}
 ]
}
```

---

### Executor Agents

These are **OpenCode agents**.

Each executes a specific task.

Example:

```
Task: Refactor auth module
```

Executor uses capabilities:

```
repo.search
file.read
file.edit
```

---

### Debugger Agent

Runs when execution fails.

Example:

```
Code fails tests
```

Debugger:

```
read error
search related code
fix issue
```

This creates **automatic repair loops**.

---

### Verifier Agent

Ensures output quality.

Checks:

```
tests pass
files compile
logic correct
```

If not:

```
return to debugger
```

---

# 3. Task Tree Execution

Tasks are **hierarchical**.

Example:

```
Refactor authentication
│
├── analyze code
│
├── refactor backend
│   ├ modify auth.ts
│   └ modify middleware.ts
│
└── update UI
```

Each node can spawn **sub-agents**.

---

# 4. Recursive Sub-Agents

Large tasks get their own mini-agents.

Example:

```
Refactor backend
```

Spawner creates a **backend refactor agent**.

That agent runs:

```
plan
execute
debug
verify
```

This is how Devin handles **huge repos**.

---

# 5. Tool Capability Layer (Integrated)

Your **capability router** now powers every agent.

Example executor request:

```
capability: repo.search
```

Router decides:

```
blaxel
embedding index
ripgrep
```

---

# 6. Context Management (Critical)

Large coding tasks exceed context limits.

Solution:

**Context layers**

```
global project summary
task context
file context
conversation
```

Agents load only what they need.

Example:

```
task: modify auth.ts
```

Load:

```
auth.ts
related files
auth docs
```

Not the whole repo.

---

# 7. Repository Intelligence Layer

Add **repo analysis workers**.

They build:

```
symbol graph
dependency graph
AST index
embedding index
```

Stored in something like:

* PostgreSQL
* Qdrant
* SQLite

Agents can query:

```
find_symbol("AuthProvider")
find_usages("loginUser")
```

This dramatically improves accuracy.

---

# 8. Autonomous Debug Loop

Elite coding agents run:

```
Execute
↓
Run tests
↓
Detect failure
↓
Repair
↓
Retry
```

Example loop:

```
edit file
run tests
error
debug
edit file
run tests
success
```

This is **one of the biggest differences** between simple agents and Devin.

---

# 9. Sandbox Strategy

You already have a powerful setup.

Capability router decides sandbox.

```
sandbox.execute
```

Router logic:

```
heavy compute → E2B
browser tasks → Daytona
repo agents → CodeSandbox
quick tasks → local microsandbox
```

---

# 10. Long-Running Task System

Agents must survive **long executions**.

Use job system:

```
Redis
Temporal
or BullMQ
```

Execution model:

```
create job
spawn agents
update progress
stream events
```

Your UI subscribes via SSE.

---

# 11. Agent State Model

Each agent stores state:

```
goal
plan
steps completed
files modified
tool history
errors
```

Stored in:

```
Redis
Postgres
or SQLite
```

This allows **resume after crash**.

---

# 12. Reflection Loop

Advanced agents evaluate their own work.

Example:

```
Agent finishes task
↓
Reflection agent reviews
↓
suggest improvements
↓
retry if needed
```

Reflection prompt example:

```
Did the changes fully implement the goal?
What edge cases remain?
```

---

# 13. Observability

Track:

```
agent latency
tool usage
token usage
failure loops
sandbox costs
```

Use:

* OpenTelemetry
* Langfuse
* Helicone

---

# 14. Ideal Architecture With Your Stack

```
NextJS UI
     │
     ▼
Agent Gateway
     │
     ▼
Supervisor Agent
     │
     ▼
Planner Agent
     │
     ▼
Task Graph
     │
 ┌───┼───────────────┐
 ▼   ▼               ▼
Executor        Debugger      Verifier
(OpenCode)      Agent         Agent
     │
     ▼
Capability Router
     │
 ┌───┼───────────────┬─────────────┐
 ▼   ▼               ▼             ▼
MCP FS   Nullclaw   Sandboxes   Repo Index
```

---

# 15. Why This Works

Benefits:

* handles **large codebases**
* agents recover from errors
* tasks run **in parallel**
* context stays small
* system scales horizontally



**“Self-Improving Agent Infrastructure”**

Where system automatically:

* creates new tools
* learns better prompts
* optimizes tool routing
* builds internal knowledge about repos

It’s the layer that makes coding agents **improve themselves over time**.
