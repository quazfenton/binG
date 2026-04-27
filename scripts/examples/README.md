# Agent Examples

A collection of use cases demonstrating what agents can do with the unified agent service.

## Quick Start

All examples use the `unified-agent-service` under the hood. Each can run standalone
or be imported as a module.

```bash
# Most examples support:
python scripts/examples/<name>/main.py
python scripts/examples/<name>/main.py --interactive
python scripts/examples/<name>/main.py --help
```

## Examples

### 🔧 File Manager
**Path:** `scripts/examples/file_manager/main.py`

Organizes local files according to business rules: batch renaming, categorizing
by type/date/department, creating directory structures.

```bash
# Setup a messy workspace
python scripts/examples/file_manager/main.py --setup

# Organize files
python scripts/examples/file_manager/main.py \
  --path /tmp/file_manager_workspace \
  --query "Organize PDFs by date"

# Interactive mode
python scripts/examples/file_manager/main.py --interactive
```

### 📊 Data Analysis
**Path:** `scripts/examples/data_analysis/main.py`

Analyzes tabular data (CSV, Excel) and generates HTML reports with statistics,
patterns, and insights.

```bash
# Create sample data
python scripts/examples/data_analysis/main.py --sample

# Analyze a file
python scripts/examples/data_analysis/main.py --file /tmp/sample_data.csv

# Interactive mode
python scripts/examples/data_analysis/main.py --interactive
```

### 🔬 Deep Research
**Path:** `scripts/examples/research/main.py`

Multi-agent research system with Planner → Searcher → Writer pipeline.

```bash
python scripts/examples/research/main.py \
  --query "Latest advances in quantum computing"

# Interactive mode
python scripts/examples/research/main.py --interactive --verbose
```

### 📈 SVG Generator
**Path:** `scripts/examples/svg_generator/main.py`

Researches a topic and creates an informative SVG visualization.

```bash
python scripts/examples/svg_generator/main.py \
  --query "Python performance tips"

# Interactive mode
python scripts/examples/svg_generator/main.py --interactive
```

### 📑 PPT Generation
**Path:** `scripts/examples/ppt_gen/main.py`

Generates structured PowerPoint presentations from text, files, or URLs.

```bash
python scripts/examples/ppt_gen/main.py \
  --query "Create a presentation about our Q4 results"

python scripts/examples/ppt_gen/main.py --file report.md

# Interactive mode
python scripts/examples/ppt_gen/main.py --interactive
```

### 🔍 RAG (Retrieval-Augmented Generation)
**Path:** `scripts/examples/rag/main.py`

Answers questions using a local knowledge base with document retrieval.

```bash
# Ingest documents
python scripts/examples/rag/main.py --ingest ./docs/

# Query
python scripts/examples/rag/main.py \
  --query "What is our Q4 revenue?"

# Interactive mode
python scripts/examples/rag/main.py --interactive
```

### 👥 Multi-Agent Collaboration
**Path:** `scripts/examples/collaboration/main.py`

Coder → Reviewer → Tester → Final Reviewer pipeline for code generation.

```bash
python scripts/examples/collaboration/main.py \
  --task "Write a binary search tree in Python"

# Interactive mode
python scripts/examples/collaboration/main.py --interactive
```

### 📝 Code Review
**Path:** `scripts/examples/code_review/main.py`

Comprehensive code review: correctness, style, security, performance, test gaps.

```bash
# Review a file
python scripts/examples/code_review/main.py --file src/main.py

# Review a directory
python scripts/examples/code_review/main.py --dir src/

# Paste code interactively
python scripts/examples/code_review/main.py --interactive
```

### 🏆 GAIA Benchmark
**Path:** `scripts/examples/gaia/main.py`

GAIA benchmark for evaluating agent capabilities on real-world complex tasks.

```bash
# Run sample tasks
python scripts/examples/gaia/main.py --sample

# Solve a specific task
python scripts/examples/gaia/main.py \
  --task "What is 2+2?"

# Interactive mode
python scripts/examples/gaia/main.py --interactive
```

### 🌐 Wikipedia Search Tool
**Path:** `scripts/examples/wiki_tool/main.py`

Shows how to wrap an external retrieval API as a structured agent tool.
Demonstrates batched queries, formatted output, and error handling — adapted
from youtu-agent's wiki_tool.py pattern.

```bash
python scripts/examples/wiki_tool/main.py \
  --query "History of the Roman Empire"

# Interactive mode
python scripts/examples/wiki_tool/main.py --interactive
```

## Architecture

All examples follow the same pattern:

```
User Input
    ↓
UnifiedAgentService (unified-agent-service.ts)
    ↓
┌─────────────────────────────────────────┐
│  Mode Selection (auto/v1-api/v2-native) │
│  ↓                                       │
│  LLM Provider (OpenAI, Anthropic, etc.) │
│  ↓                                       │
│  Tool Execution (file, bash, search)    │
└─────────────────────────────────────────┘
    ↓
Structured Response
```

Each example:
- Uses `UnifiedAgentConfig` for configuration
- Calls `processUnifiedAgentRequest()` for execution
- Supports `--interactive` flag for CLI interaction
- Can be imported as a module for programmatic use

## Adding Your Own Example

1. Create a directory: `scripts/examples/your_example/`
2. Write `main.py` using the pattern:

```python
from web.lib.orchestra.unified_agent_service import (
    processUnifiedAgentRequest,
    UnifiedAgentConfig,
)

config = UnifiedAgentConfig(
    userMessage="Your task here",
    systemPrompt="Your system prompt here",
    maxSteps=20,
    mode="v1-api",
)

result = await processUnifiedAgentRequest(config)
```

3. Add to this README
