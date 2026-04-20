---
id: improving-vfs-mcp-tool-use-with-self-learning
title: Improving VFS MCP Tool Use with Self-Learning
aliases:
  - vfs-tool-learning-guide
  - vfs-tool-learning-guide.md
tags: []
layer: core
summary: "# Improving VFS MCP Tool Use with Self-Learning\r\n\r\nThis guide shows how to use the **Training-Free GRPO** practice module to reduce\r\nVFS MCP tool failures — especially for less capable models that struggle with\r\ncorrect tool calling patterns for `write_file`, `batch_write`, and `apply_diff`.\r\n\r\n## T"
anchors:
  - The Problem
  - Quick Start
  - 1. Load the dataset
  - 2. Configure your model
  - 3. Run practice
  - 4. Evaluate the enhanced agent
  - What the Enhanced Prompt Looks Like
  - Adding Your Own Tasks
  - Using the Enhanced Agent in Production
  - Customizing the Verifier
  - Cost Estimate
  - Architecture
  - Why This Works for Smaller Models
---
# Improving VFS MCP Tool Use with Self-Learning

This guide shows how to use the **Training-Free GRPO** practice module to reduce
VFS MCP tool failures — especially for less capable models that struggle with
correct tool calling patterns for `write_file`, `batch_write`, and `apply_diff`.

## The Problem

Smaller or less capable models commonly fail at VFS tool use in these ways:

| Failure | Example | Fix via practice |
|---|---|---|
| **Wrong field names** | `{file: "foo.py", code: "..."}` instead of `{path: "foo.py", content: "..."}` | Experience teaches correct schema |
| **Wrong tool names** | `create_file`, `saveFile`, `writeToFile` | Experience maps aliases to canonical names |
| **Missing arguments** | `{path: "foo.py"}` without `content` | Experience flags required fields |
| **Malformed batch_write** | Stringified JSON, wrong nesting, no `files=` key | Experience learns correct structure |
| **Bad diffs** | Invalid unified diff format for `apply_diff` | Experience extracts correct diff patterns |
| **No tool attempt** | Model writes code blocks without invoking tools | Experience learns to use tools explicitly |

## Quick Start

### 1. Load the dataset

```bash
# This creates 12 VFS tool usage tasks in the local SQLite database
python scripts/practice/prepare_vfs_dataset.py
```

### 2. Configure your model

Edit `configs/practice/vfs_tool_use.yaml`:

```yaml
evaluation:
  agent:
    model:
      model_provider:
        type: chat.completions
        model: your-model-name      # ← the model you want to improve
        base_url: https://your-api   # ← your LLM endpoint
        api_key: your-key            # ← your API key
```

### 3. Run practice

```bash
python scripts/practice/run_training_free_GRPO.py --config_name vfs_tool_use
```

This will:
1. **Rollout**: Run your model 3× per task (GRPO group) at temperature 0.7
2. **Judge**: Score each rollout with `verify/vfs_tool_use.py`
3. **Summarize**: Analyze successful vs failed tool calls
4. **Extract**: Pull out concise guidelines like:
   *"Always use `path` and `content` as field names — never `file` or `code`"*
5. **Save**: Write enhanced agent config with experiences embedded

### 4. Evaluate the enhanced agent

After practice, you'll get a new config file:
`configs/agents/practice/vfs_tool_eval_agent.yaml`

This file contains the original instructions **+ extracted experiences** injected
as mandatory guidelines. Use it in your agent configuration.

## What the Enhanced Prompt Looks Like

After practice, the agent's instructions will be augmented like this:

```
You are an expert software engineer with access to a Virtual File System (VFS).

When solving problems, you MUST first carefully read and understand
the helpful instructions and experiences:

[1]. Always use the canonical tool name `write_file` — never `create_file`,
     `saveFile`, or `writeToFile`. The tool expects `path` and `content`
     as field names, not `file` or `code`.

[2]. For batch_write, pass `files` as a proper array of objects with
     `path` and `content` keys. Do not stringify the JSON.

[3]. When using apply_diff, ensure the diff is valid unified diff
     format starting with --- and +++ headers.

[4]. Always verify file creation by reading the file back after writing.
```

These experiences are **extracted from actual successful rollouts** — not
hand-crafted. They reflect what your specific model got right.

## Adding Your Own Tasks

Edit `scripts/practice/prepare_vfs_dataset.py` and add tasks that match
your real-world failure patterns:

```python
VFS_TASKS = [
    # Your actual failure cases
    {
        "question": "Your real task that failed before",
        "answer": "Expected tool call pattern",
    },
    # ...
]
```

Then re-run:
```bash
python scripts/practice/prepare_vfs_dataset.py  # reloads with new tasks
python scripts/practice/run_training_free_GRPO.py --config_name vfs_tool_use
```

## Using the Enhanced Agent in Production

Once you have experiences, inject them into your unified agent config:

```python
from web.lib.orchestra.unified_agent_service import (
    processUnifiedAgentRequest,
    UnifiedAgentConfig,
)

# Load experiences from practice output
EXPERIENCES = """
When using VFS tools, follow these rules:
[1]. Always use `path` and `content` as field names.
[2]. Use `write_file` not `create_file`.
[3]. For batch_write, `files` must be a JSON array.
"""

config = UnifiedAgentConfig(
    userMessage="Create src/App.tsx with a React component",
    systemPrompt=f"You are a coding agent.\n\n{EXPERIENCES}",
    maxSteps=30,
    mode="v1-api",
)

result = await processUnifiedAgentRequest(config)
```

## Customizing the Verifier

The verifier at `packages/shared/agent/practice/verify/vfs_tool_use.py` checks:

1. Did the agent attempt to use VFS tools?
2. Were tool names correct?
3. Were argument structures correct?
4. Was file content substantial?
5. Was task completion reported?

To add more checks (e.g., "did the file actually exist"), extend the verifier:

```python
def verify_func(sample, **kwargs):
    # Your custom check
    if sample.metadata and "tool_calls" in sample.metadata:
        for tc in sample.metadata["tool_calls"]:
            if tc.get("tool") == "write_file" and not tc.get("args", {}).get("path"):
                return {"reward": 0.0, "reasoning": "write_file missing path argument"}
    # ...
```

## Cost Estimate

For 12 tasks × 3 rollouts × 3 epochs = **108 LLM calls** for rollouts,
plus ~36 calls for experience extraction = **~144 total**.

At $0.150/1M tokens for gpt-4o-mini (~2k tokens per call), this costs roughly **$0.04**.

## Architecture

```
Task: "Create hello.py"
  │
  ├─ Rollout 1 (temp 0.7) → Agent calls write_file correctly     → Reward: 1.0 ✓
  ├─ Rollout 2 (temp 0.7) → Agent calls create_file (wrong name) → Reward: 0.3 ✗
  └─ Rollout 3 (temp 0.7) → Agent writes code without tools      → Reward: 0.0 ✗
  │
  ├─ Summarize: Rollout 1 succeeded because it used canonical tool name
  ├─ Extract: "Always use write_file, not create_file"
  │
  └─ Inject into next epoch's system prompt as mandatory instruction
```

## Why This Works for Smaller Models

Smaller models (gpt-4o-mini, Claude Haiku, Mistral Small) lack the implicit
knowledge to get tool schemas right from descriptions alone. They need:

1. **Concrete examples** — not abstract descriptions of the schema
2. **Repeated exposure** — seeing the correct pattern multiple times
3. **Contrast** — seeing what went wrong alongside what went right
4. **Explicit rules** — distilled into short, mandatory instructions

Training-Free GRPO provides all four through its rollout → judge → extract
pipeline, without any model weight updates.
