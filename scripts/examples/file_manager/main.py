"""File Manager Example

An agent that organizes local files according to business rules:
- Batch renaming with consistent naming conventions
- Organizing documents into logical directory structures
- Handling file categorization by type, date, or department
- Safe operations (no deletion, no scripts, relative paths only)

Usage:
    python scripts/examples/file_manager/main.py
    python scripts/examples/file_manager/main.py --path /path/to/messy/folder
    python scripts/examples/file_manager/main.py --query "Organize PDFs by date"
"""

import asyncio
import argparse
import os
import sys
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

INSTRUCTIONS = """\
You are a professional file management assistant specialized in business document organization.

## Core Workflow Principle
- **Batch Processing First**: After using `ls` to inspect files, analyze the entire file set and plan operations FOR EACH file
- **Command Chaining**: Connect individual file operations using `&&` to process multiple files in single tool calls
- **Minimize Tool Calls**: Group related file operations into single bash commands when safe and practical

## Primary Responsibilities
- Organize business documents (contracts, invoices, reports) into logical directory structures
- Batch rename files using consistent business naming conventions
- Create and manage directory hierarchies for business workflows
- Handle file categorization based on content type, date, project, or department

## Critical Constraints
**STRICTLY PROHIBITED:**
- Never use `for` loops, `while` loops, or any shell scripting constructs
- Never use complex pattern matching with advanced wildcards or regular expressions
- Never access or modify files outside current working directory
- Never use `rm` for file deletion (offer trash directory alternative)
- Never use `sudo` or elevated privileges
- Never change working directory with `cd`
- Never executing complex scripts which is very long.

## Batch Operation Guidelines
1. **Initial Assessment**: Use `ls` to understand the complete file landscape
2. **Individual Planning**: Determine the specific operation needed for each file, NEVER use for loop
3. **Command Chaining**: Connect individual operations using `&&` operator
4. **Safe Execution**: Execute chained commands with proper error handling
5. **Verification**: Use `ls`/`find` to confirm operation completion

## Safety Protocols
- Always verify operations with follow-up `ls` commands
- Use relative paths exclusively
- Create necessary directories before file moves
- Ask for clarification when business context is unclear

## Communication Style
- Summarize batch operations rather than detailing each individual file
- Provide representative examples when helpful
- Report errors immediately and await instructions
- Confirm completion with a final directory listing
"""


def run_sync(query: str, workspace: str):
    """Run file manager with the unified agent (synchronous wrapper)."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    # Ensure workspace exists
    os.makedirs(workspace, exist_ok=True)

    # Build full query with workspace context
    full_query = f"Working directory: {workspace}\n\nTask: {query}"

    config = UnifiedAgentConfig(
        userMessage=full_query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=50,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        print(f"\n✓ File management complete")
        print(f"\nResponse: {result.response}")
        print(f"\nFiles modified: {result.metadata.get('filesModified', 0)}")
        print(f"Steps taken: {result.totalSteps}")
    else:
        print(f"\n✗ Failed: {result.error}")


async def run_async(query: str, workspace: str):
    """Run file manager with the unified agent (async)."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    os.makedirs(workspace, exist_ok=True)
    full_query = f"Working directory: {workspace}\n\nTask: {query}"

    config = UnifiedAgentConfig(
        userMessage=full_query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=50,
        mode="v1-api",
    )

    result = await processUnifiedAgentRequest(config)

    if result.success:
        print(f"\n✓ File management complete")
        print(f"\nResponse: {result.response}")
    else:
        print(f"\n✗ Failed: {result.error}")


def create_messy_workspace(path: str):
    """Create a realistic messy workspace — adapted from youtu-agent's prepare_messy_files.py.

    Generates 20-40 student submissions with:
    - Random naming patterns (name_id_title, id-name-title, title_name_id)
    - Varied delimiters (_, -, space, none, double underscore)
    - Duplicate submissions (~30% of students submit twice)
    - Mixed extensions (pdf weighted 70%, plus docx/txt)
    - Non-submission files (README, .gitignore, etc.)
    """
    import random
    random.seed(42)  # reproducible

    workspace = Path(path)
    workspace.mkdir(parents=True, exist_ok=True)

    # Clear existing files if workspace not empty
    existing = list(workspace.iterdir())
    if existing:
        print(f"Warning: {workspace} has {len(existing)} existing files. They will be kept.")

    names = ["张三", "李四", "王五", "赵六", "孙七", "周八", "吴九", "郑十",
             "冯十一", "陈十二", "Alice", "Bob", "Charlie", "Diana", "Eve", "Frank",
             "Grace", "Henry", "Ivy", "Jack"]
    ids = [f"2024{str(i).zfill(3)}" for i in range(1, len(names) + 1)]
    titles = ["实验报告", "课程报告", "final_project", "homework", "assignment",
              "report", "大作业", "数据结构大作业", "课程设计"]
    extensions = ["pdf"] * 14 + ["docx"] * 4 + ["txt"] * 2  # 70% pdf
    formats = [
        "{name}_{id}_{title}.{ext}",
        "{id}_{name}_{title}.{ext}",
        "{title}_{name}_{id}.{ext}",
        "{name}-{id}-{title}.{ext}",
        "{id}-{name}-{title}.{ext}",
        "{name}{id}{title}.{ext}",
        "{name}  {id}  {title}.{ext}",
    ]

    created = []
    duplicate_count = 0
    for i, name in enumerate(names):
        sid = ids[i]
        # ~30% of students submit duplicates
        repeats = 2 if random.random() < 0.3 else 1
        if repeats > 1:
            duplicate_count += 1
        for _ in range(repeats):
            fmt = random.choice(formats)
            fname = fmt.format(
                name=name, id=sid, title=random.choice(titles), ext=random.choice(extensions)
            )
            fpath = workspace / fname
            fpath.write_text(f"Submission by {name} (ID: {sid})\nTitle: {random.choice(titles)}")
            created.append(fname)

    # Non-submission noise files
    for extra in ["README.md", ".gitignore", "notes.txt", "archive.zip", "temp.docx"]:
        fpath = workspace / extra
        if not fpath.exists():
            fpath.write_text(f"Extra file: {extra}")
            created.append(extra)

    print(f"Created messy workspace at: {workspace}")
    print(f"Generated {len(created)} files")
    print(f"  - {len(names)} students, {duplicate_count} with duplicate submissions")
    print(f"  - {len(formats)} naming patterns with varied delimiters (_, -, space, none, __)")
    print(f"  - Extensions: ~70% pdf, rest docx/txt")


def main():
    parser = argparse.ArgumentParser(description="File Manager Example")
    parser.add_argument("--path", default="/tmp/file_manager_workspace",
                        help="Workspace directory path")
    parser.add_argument("--query",
                        default="整理当前文件夹下的所有文件，按文件类型分类到不同的文件夹中。",
                        help="Task description")
    parser.add_argument("--setup", action="store_true",
                        help="Create a messy workspace for testing")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.setup:
        create_messy_workspace(args.path)
        print("\nNow run without --setup to organize the files.")
        return

    if args.interactive:
        print(f"Workspace: {args.path}")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            run_sync(query, args.path)
        return

    run_sync(args.query, args.path)


if __name__ == "__main__":
    main()
