"""Code Review Example

An agent that performs comprehensive code review checking:
- Correctness and bugs
- Style and conventions
- Security vulnerabilities
- Performance issues
- Test coverage gaps

Usage:
    python scripts/examples/code_review/main.py --file path/to/file.py
    python scripts/examples/code_review/main.py --dir src/
    python scripts/examples/code_review/main.py --interactive
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
You are a senior code reviewer specializing in correctness, style, security, and performance.

## Review Process
1. Read and understand the code
2. Check for correctness: bugs, edge cases, error handling
3. Check style: naming, formatting, conventions, readability
4. Check security: injection risks, data exposure, auth issues
5. Check performance: unnecessary allocations, N+1 queries, memory leaks
6. Check testability: can this be tested? Are there test gaps?

## Output Format
Structure your review as follows:

### ✅ Strengths
- What's done well

### ⚠️ Issues

#### Critical (must fix before merge)
- ...

#### Suggestions (nice to fix)
- ...

### 📊 Summary
- Overall assessment
- APPROVE or REQUEST_CHANGES

## Guidelines
- Be specific: point to exact lines/code
- Be constructive: suggest fixes, not just problems
- Be balanced: acknowledge good code too
- Prioritize: critical issues first
- Don't nitpick: focus on what matters
"""


def review_file(file_path: str):
    """Review a single file."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    abs_path = os.path.abspath(file_path)
    if not os.path.exists(abs_path):
        print(f"File not found: {abs_path}")
        return

    with open(abs_path, "r", encoding="utf-8") as f:
        code = f.read()

    query = f"Review this code from {abs_path}:\n\n```{Path(abs_path).suffix.lstrip('.')}\n{code}\n```"

    config = UnifiedAgentConfig(
        userMessage=query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=15,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        print(f"\n{'='*60}")
        print(f"REVIEW: {abs_path}")
        print(f"{'='*60}\n")
        print(result.response)
    else:
        print(f"\n✗ Review failed: {result.error}")


def review_directory(dir_path: str, max_files: int = 5):
    """Review multiple files in a directory."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    dir_path = os.path.abspath(dir_path)
    if not os.path.isdir(dir_path):
        print(f"Not a directory: {dir_path}")
        return

    # Find code files
    code_extensions = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".cpp", ".c", ".h"}
    files = []
    for root, _, filenames in os.walk(dir_path):
        # Skip node_modules, .git, __pycache__, etc.
        skip_dirs = {"node_modules", ".git", "__pycache__", "dist", "build", "vendor", ".venv"}
        if any(skip in root.split(os.sep) for skip in skip_dirs):
            continue
        for fname in filenames:
            if Path(fname).suffix in code_extensions:
                files.append(os.path.join(root, fname))

    files = files[:max_files]
    print(f"Reviewing {len(files)} files from {dir_path}\n")

    # Read all files
    all_code = []
    for fpath in files:
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                code = f.read()
            rel_path = os.path.relpath(fpath, dir_path)
            ext = Path(fpath).suffix.lstrip(".")
            all_code.append(f"## {rel_path}\n\n```{ext}\n{code}\n```")
        except Exception as e:
            print(f"  Skipping {fpath}: {e}")

    if not all_code:
        print("No code files found to review.")
        return

    query = f"Review these files from {dir_path}:\n\n" + "\n\n".join(all_code)

    config = UnifiedAgentConfig(
        userMessage=query,
        systemPrompt=INSTRUCTIONS,
        maxSteps=20,
        mode="v1-api",
    )

    result = asyncio.get_event_loop().run_until_complete(
        processUnifiedAgentRequest(config)
    )

    if result.success:
        print(f"\n{'='*60}")
        print(f"REVIEW: {dir_path} ({len(files)} files)")
        print(f"{'='*60}\n")
        print(result.response)
    else:
        print(f"\n✗ Review failed: {result.error}")


def main():
    parser = argparse.ArgumentParser(description="Code Review Example")
    parser.add_argument("--file", help="File to review")
    parser.add_argument("--dir", help="Directory to review (multiple files)")
    parser.add_argument("--max-files", type=int, default=5,
                        help="Max files to review in directory mode")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        print("Code Review Agent - Interactive Mode")
        print("Enter a file path, directory, or paste code to review")
        print("Type 'exit' to quit\n")
        while True:
            user_input = input("> ").strip()
            if user_input.lower() in ("exit", "quit", "q"):
                break
            if not user_input:
                continue
            if os.path.isfile(user_input):
                review_file(user_input)
            elif os.path.isdir(user_input):
                review_directory(user_input, max_files=args.max_files)
            else:
                # Treat as inline code
                print("\nReviewing pasted code...\n")
                from web.lib.orchestra.unified_agent_service import (
                    processUnifiedAgentRequest,
                    UnifiedAgentConfig,
                )
                config = UnifiedAgentConfig(
                    userMessage=f"Review this code:\n\n{user_input}",
                    systemPrompt=INSTRUCTIONS,
                    maxSteps=15,
                    mode="v1-api",
                )
                result = asyncio.get_event_loop().run_until_complete(
                    processUnifiedAgentRequest(config)
                )
                if result.success:
                    print(result.response)
                else:
                    print(f"✗ Review failed: {result.error}")
        return

    if args.file:
        review_file(args.file)
    elif args.dir:
        review_directory(args.dir, max_files=args.max_files)
    else:
        print("Specify a file with --file or directory with --dir")


if __name__ == "__main__":
    main()
