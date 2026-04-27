---
id: terminaluse-quickstart-for-bing
title: TerminalUse Quickstart for binG
aliases:
  - terminaluse-quickstart
  - terminaluse-quickstart.md
tags:
  - terminal
layer: core
summary: "# TerminalUse Quickstart for binG\r\n\r\nThis guide walks you through creating, deploying, and using a TerminalUse agent with binG.\r\n\r\n## Prerequisites\r\n\r\n1. **TerminalUse Account**: Sign up at https://app.terminaluse.com\r\n2. **API Key**: Get from https://app.terminaluse.com/settings/api-keys\r\n3. **UV P"
anchors:
  - Prerequisites
  - 'Step 1: Install TerminalUse CLI'
  - 'Step 2: Configure binG'
  - 'Step 3: Create a binG Agent'
  - Initialize Agent Project
  - Configure Agent for binG
  - 'Turn {turns}'
  - Status
  - Next Steps
  - Update config.yaml
  - 'Step 4: Deploy Agent'
  - 'Step 5: Create Project for Filesystems'
  - 'Step 6: Use Agent from binG'
  - 'Option A: Via binG UI'
  - 'Option B: Via API'
  - 'Option C: Via binG TerminalUse Integration'
  - 'Step 7: Continue Conversation'
  - 'Step 8: Pull Results'
  - 'Step 9: Monitor and Debug'
  - View Task Events
  - View Messages
  - Check State
  - Common Workflows
  - Code Review Workflow
  - Refactoring Workflow
  - Batch Analysis Workflow
  - Troubleshooting
  - Agent Not Found
  - Filesystem Issues
  - Task Stuck
  - Permission Denied
  - Next Steps
  - Resources
---
# TerminalUse Quickstart for binG

This guide walks you through creating, deploying, and using a TerminalUse agent with binG.

## Prerequisites

1. **TerminalUse Account**: Sign up at https://app.terminaluse.com
2. **API Key**: Get from https://app.terminaluse.com/settings/api-keys
3. **UV Package Manager**: Install from https://github.com/astral-sh/uv

## Step 1: Install TerminalUse CLI

```bash
# Install via uv
uv tool install terminaluse

# Verify installation
tu --version

# If `tu` is not found, update shell
uv tool update-shell

# Restart your shell, then login
tu login
```

## Step 2: Configure binG

Add to your `.env.local`:

```env
# TerminalUse API Key (required)
TERMINALUSE_API_KEY=tu_your_api_key_here

# Optional: Custom API base URL
#TERMINALUSE_BASE_URL=https://api.terminaluse.com

# Optional: Default namespace
#TERMINALUSE_NAMESPACE=my-namespace

# Optional: Default project for filesystems
#TERMINALUSE_PROJECT_ID=proj_xxxxx

# Add to sandbox provider fallback chain
SANDBOX_PROVIDER_FALLBACK_CHAIN=daytona,e2b,terminaluse,modal-com,mistral-agent,modal
```

## Step 3: Create a binG Agent

### Initialize Agent Project

```bash
# Create agent directory
mkdir bing-agent && cd bing-agent

# Initialize TerminalUse agent
tu init
```

This creates:
```
bing-agent/
├── config.yaml      # Agent configuration
├── Dockerfile       # Build configuration
└── src/
    └── agent.py     # Agent logic
```

### Configure Agent for binG

Replace `src/agent.py` with:

```python
"""
binG Cloud Agent for TerminalUse

This agent handles code analysis, refactoring, and file operations
with persistent filesystem support.
"""

from typing import Any
import json
from pathlib import Path

from terminaluse.lib import AgentServer, TaskContext, Event, TextPart, DataPart

server = AgentServer()


@server.on_create
async def handle_create(ctx: TaskContext, params: dict[str, Any]):
    """Initialize task when created."""
    # Initialize state
    await ctx.state.create({
        "step": "initialized",
        "files_processed": 0,
        "changes_made": [],
        "turns": 0,
    })
    
    # Get goal from params
    goal = params.get("goal", "No goal specified")
    
    await ctx.messages.send(
        f"🚀 binG agent initialized!\n\n"
        f"**Goal**: {goal}\n\n"
        f"Send me code analysis or refactoring tasks. "
        f"I'll work with files in /workspace."
    )


@server.on_event
async def handle_event(ctx: TaskContext, event: Event):
    """Handle incoming events (user messages)."""
    if not isinstance(event.content, TextPart):
        await ctx.messages.send("⚠️ Only text events are supported.")
        return

    # Update state
    state = await ctx.state.get() or {"turns": 0, "files_processed": 0}
    turns = state.get("turns", 0) + 1
    await ctx.state.update({"turns": turns, "step": "processing"})

    user_message = event.content.text
    
    # Process the request
    await ctx.messages.send(f"🤔 Processing: {user_message[:100]}...")
    
    # Example: List workspace files
    workspace = Path("/workspace")
    if workspace.exists():
        files = list(workspace.glob("**/*.py")) + list(workspace.glob("**/*.ts"))
        await ctx.messages.send(
            f"📁 Found {len(files)} code files in /workspace\n\n"
            f"First 10:\n" + "\n".join(str(f.relative_to(workspace)) for f in files[:10])
        )
    
    # Example: Create analysis report
    report_path = workspace / "analysis_report.md"
    report_content = f"""# binG Analysis Report

## Turn {turns}
**Request**: {user_message}

## Status
- Files processed: {state.get('files_processed', 0)}
- Step: processing

## Next Steps
1. Analyze code structure
2. Identify improvements
3. Generate refactoring suggestions
"""
    
    report_path.write_text(report_content)
    
    await ctx.state.update({
        "step": "completed",
        "files_processed": state.get("files_processed", 0) + 1,
        "last_report": str(report_path),
    })
    
    await ctx.messages.send(
        f"✅ Analysis complete!\n\n"
        f"Report saved to: `/workspace/analysis_report.md`\n\n"
        f"Use `tu tasks pull {ctx.task.id} --out ./output` to download results."
    )


@server.on_cancel
async def handle_cancel(ctx: TaskContext):
    """Handle task cancellation."""
    state = await ctx.state.get() or {}
    await ctx.messages.send(
        f"⚠️ Task cancelled.\n\n"
        f"Progress: {state.get('step', 'unknown')}\n"
        f"Turns completed: {state.get('turns', 0)}"
    )
```

### Update config.yaml

```yaml
agent:
  name: bing-code-agent
  description: binG cloud agent for code analysis and refactoring
  runtime:
    python: "3.12"
  resources:
    cpu: "2"
    memory: "4Gi"
  timeout: 3600  # 1 hour
```

## Step 4: Deploy Agent

```bash
# Deploy to TerminalUse
tu deploy -y

# Verify deployment
tu agents list
```

## Step 5: Create Project for Filesystems

```bash
# Create project (permission boundary for filesystems)
tu projects create --namespace your-namespace --name bing-workspace

# Copy the project ID from output
# Example: proj_abc123xyz
```

## Step 6: Use Agent from binG

### Option A: Via binG UI

1. Open binG chat interface
2. Select TerminalUse as sandbox provider
3. Send message: "Analyze the codebase for improvements"
4. binG creates task and streams responses

### Option B: Via API

```bash
# Create task with filesystem
tu tasks create \
  -a your-namespace/bing-code-agent \
  -p proj_abc123xyz \
  -m "Analyze the TypeScript files for code smells"

# Copy task ID from output
# Example: task_def456uvw
```

### Option C: Via binG TerminalUse Integration

```typescript
import { TerminalUseProvider } from '@/lib/sandbox/providers/terminaluse-provider'
import { createTerminalUseAgentService } from '@/lib/sandbox/spawn/terminaluse-agent-service'

const provider = new TerminalUseProvider()
const handle = await provider.createSandbox({
  labels: { project_id: 'proj_abc123xyz' },
})

const agentService = createTerminalUseAgentService(handle)

const result = await agentService.run({
  agent_name: 'your-namespace/bing-code-agent',
  prompt: 'Refactor the authentication module',
  streamEvents: true,
  onEvent: (event) => {
    console.log('Agent event:', event)
  },
})

console.log('Task completed:', result.taskId)
```

## Step 7: Continue Conversation

```bash
# Send follow-up event
tu tasks send task_def456uvw -m "Now focus on the database layer"

# View task status
tu tasks get task_def456uvw
```

## Step 8: Pull Results

```bash
# Download workspace and system folders
tu tasks pull task_def456uvw --out ./bing-output

# Results will be in:
# ./bing-output/workspace/analysis_report.md
# ./bing-output/workspace/... (other files)
```

## Step 9: Monitor and Debug

### View Task Events

```bash
# List all events
tu tasks events task_def456uvw

# Stream events in real-time
tu tasks stream task_def456uvw
```

### View Messages

```bash
# List all messages
tu tasks messages task_def456uvw
```

### Check State

```bash
# Get task state (requires agent access)
tu tasks state task_def456uvw
```

## Common Workflows

### Code Review Workflow

```bash
# 1. Create task for code review
tu tasks create \
  -a your-namespace/bing-code-agent \
  -p proj_abc123xyz \
  -m "Review src/auth.ts for security issues"

# 2. Agent analyzes and creates report

# 3. Pull results
tu tasks pull TASK_ID --out ./review-output

# 4. Review report
cat ./review-output/workspace/security_report.md
```

### Refactoring Workflow

```bash
# 1. Create task
tu tasks create \
  -a your-namespace/bing-code-agent \
  -p proj_abc123xyz \
  -m "Refactor utils.py to use async/await"

# 2. Send follow-up with specific requirements
tu tasks send TASK_ID -m "Also add type hints and docstrings"

# 3. Send another iteration
tu tasks send TASK_ID -m "Add unit tests for the refactored functions"

# 4. Pull refactored code
tu tasks pull TASK_ID --out ./refactored-output
```

### Batch Analysis Workflow

```bash
# Create multiple tasks for parallel analysis
tu tasks create -a your-namespace/bing-code-agent -p proj_abc123xyz -m "Analyze module A"
tu tasks create -a your-namespace/bing-code-agent -p proj_abc123xyz -m "Analyze module B"
tu tasks create -a your-namespace/bing-code-agent -p proj_abc123xyz -m "Analyze module C"

# Monitor all tasks
tu tasks list --limit 10
```

## Troubleshooting

### Agent Not Found

```bash
# Verify agent is deployed
tu agents list

# Check agent name matches
tu agents get your-namespace/bing-code-agent
```

### Filesystem Issues

```bash
# Verify project exists
tu projects list

# Check filesystem was created
tu filesystems list --project proj_abc123xyz
```

### Task Stuck

```bash
# Check task status
tu tasks get TASK_ID

# Cancel if stuck
tu tasks cancel TASK_ID

# Recreate with new task
tu tasks create ...
```

### Permission Denied

```bash
# Verify you have access to project
tu projects get proj_abc123xyz

# Check collaborator access
tu projects collaborators proj_abc123xyz
```

## Next Steps

1. **Customize Agent Logic**: Modify `src/agent.py` for your use case
2. **Add Tools**: Integrate with binG tools via TerminalUse ADK
3. **Multi-Agent Workflows**: Create specialized agents for different tasks
4. **Production Deployment**: Set up CI/CD for agent updates

## Resources

- [TerminalUse Docs](https://docs.terminaluse.com/)
- [ADK Reference](https://docs.terminaluse.com/api-reference/adk)
- [binG Integration Docs](./terminaluse-integration.md)
- [CLI Reference](https://docs.terminaluse.com/api-reference/cli)
