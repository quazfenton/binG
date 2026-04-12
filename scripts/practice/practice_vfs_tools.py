"""
VFS Tool Call Practice — Lightweight Trainer

A simpler alternative to Training-Free GRPO that:
1. Runs the model on VFS tool tasks
2. Evaluates tool call correctness (no file system needed)
3. Extracts common mistakes and patterns
4. Generates an enhanced system prompt with learned experiences

Usage:
    python scripts/practice/practice_vfs_tools.py --model gpt-4o-mini --rounds 3
    python scripts/practice/practice_vfs_tools.py --interactive
    python scripts/practice/practice_vfs_tools.py --generate-prompt  # Output enhanced prompt
"""

import asyncio
import argparse
import json
import os
import re
import sys
import hashlib
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


# ─── VFS Tool Tasks ──────────────────────────────────────────────────────
# Tasks that test common failure points for less capable models.

VFS_TASKS = [
    ("Create a hello.py that prints 'Hello World'", "write_file"),
    ("Create src/App.tsx with a basic React component", "write_file"),
    ("Set up a Flask app with templates/index.html and requirements.txt", "batch_write"),
    ("Create a JSON config file with database settings", "write_file"),
    ("Add error handling to api.py's fetch_data function", "apply_diff"),
    ("Create a Python package: mypkg/__init__.py, mypkg/core.py, tests/test_core.py", "batch_write"),
    ("Create README.md with Overview, Installation, Usage sections", "write_file"),
    ("Create models/user.py, routes/auth.py, and middleware/auth.py", "batch_write"),
]


# ─── Tool Call Evaluator ─────────────────────────────────────────────────

@dataclass
class ToolCallAnalysis:
    task: str
    response: str
    tool_calls_found: int
    correct_tool_names: bool
    correct_arguments: bool
    missing_fields: list[str]
    wrong_tool_names: list[str]
    score: float
    feedback: str


def evaluate_tool_calls(task: str, response: str) -> ToolCallAnalysis:
    """Evaluate whether the response uses VFS tools correctly."""
    missing = []
    wrong_names = []
    score = 0.0
    feedback_parts = []

    # Find tool calls in response
    tool_patterns = [
        r'write_file\s*\(',
        r'batch_write\s*\(',
        r'apply_diff\s*\(',
        r'read_file\s*\(',
    ]
    wrong_patterns = [
        (r'create_file\s*\(', 'create_file → write_file'),
        (r'save_file\s*\(', 'save_file → write_file'),
        (r'saveFile\s*\(', 'saveFile → write_file'),
        (r'writeToFile\s*\(', 'writeToFile → write_file'),
        (r'writeFile\s*\(', 'writeFile → write_file'),
        (r'make_file\s*\(', 'make_file → write_file'),
    ]

    tools_found = sum(1 for p in tool_patterns if re.search(p, response))

    # Check correct tool names
    correct_names = all(
        any(re.search(p, response) for p in tool_patterns)
        for _ in [1]
    ) if tools_found > 0 else False

    # Check wrong tool names
    for pattern, correction in wrong_patterns:
        if re.search(pattern, response):
            wrong_names.append(correction)

    # Check argument correctness
    has_path = bool(re.search(r'path\s*[=:]\s*["\']', response))
    has_content = bool(re.search(r'content\s*[=:]\s*["\']', response))
    has_files = bool(re.search(r'files\s*[=:]\s*\[', response))
    has_diff = bool(re.search(r'diff\s*[=:]\s*["\']', response))

    # Determine which args are missing
    if "batch" in task.lower() or any(w in task.lower() for w in ["three files", "multiple", "package", "structure"]):
        if not has_files:
            missing.append("files=[]")
    else:
        if not has_path:
            missing.append("path=...")
        if not has_content:
            missing.append("content=...")

    # Score calculation
    if tools_found > 0:
        score += 0.3
    if correct_names and not wrong_names:
        score += 0.3
    if not missing:
        score += 0.2
    if len(response) > 50:
        score += 0.2

    # Build feedback
    if not tools_found:
        feedback_parts.append("No tool calls detected — model wrote code without using tools")
    else:
        feedback_parts.append(f"Found {tools_found} tool call(s)")

    if wrong_names:
        feedback_parts.append(f"Wrong tool names: {', '.join(wrong_names)}")

    if missing:
        feedback_parts.append(f"Missing arguments: {', '.join(missing)}")

    if not missing and correct_names:
        feedback_parts.append("Correct tool usage")

    return ToolCallAnalysis(
        task=task,
        response=response,
        tool_calls_found=tools_found,
        correct_tool_names=correct_names and not wrong_names,
        correct_arguments=not missing,
        missing_fields=missing,
        wrong_tool_names=wrong_names,
        score=min(score, 1.0),
        feedback="; ".join(feedback_parts),
    )


# ─── LLM Runner ──────────────────────────────────────────────────────────

async def run_llm(user_message: str, system_prompt: str, model: str, temperature: float = 0.7) -> str:
    """Run an LLM call."""
    from openai import AsyncOpenAI

    base_url = os.environ.get("UTU_LLM_BASE_URL")
    api_key = os.environ.get("UTU_LLM_API_KEY", "dummy")

    client = AsyncOpenAI(api_key=api_key, base_url=base_url or None)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=temperature,
        max_tokens=2000,
    )

    return response.choices[0].message.content or ""


# ─── Experience Extractor ────────────────────────────────────────────────

def extract_experiences(analyses: list[ToolCallAnalysis]) -> list[str]:
    """Extract lessons from the practice run."""
    experiences = []

    # Aggregate common mistakes
    all_wrong = {}
    all_missing = {}
    success_count = 0

    for a in analyses:
        if a.score >= 0.8:
            success_count += 1
        for w in a.wrong_tool_names:
            all_wrong[w] = all_wrong.get(w, 0) + 1
        for m in a.missing_fields:
            all_missing[m] = all_missing.get(m, 0) + 1

    # Generate experiences from patterns
    if all_wrong:
        for wrong, count in sorted(all_wrong.items(), key=lambda x: -x[1]):
            experiences.append(
                f"Never use `{wrong.split(' → ')[0]}` — the correct tool name is `{wrong.split(' → ')[1]}`"
            )

    if all_missing:
        for missing_field, count in sorted(all_missing.items(), key=lambda x: -x[1]):
            experiences.append(
                f"Always provide the `{missing_field}` argument when calling write_file or batch_write"
            )

    # Positive lessons
    if success_count > 0:
        experiences.append(
            f"Use write_file(path='filename.ext', content='...') for single files — "
            "always include both path and content as separate arguments"
        )
        experiences.append(
            f"Use batch_write(files=[{{path: '...', content: '...'}}, ...]) for multiple files — "
            "pass files as an array, not a stringified JSON"
        )

    if not experiences:
        experiences.append(
            "The model needs more practice with VFS tool usage — "
            "try running more rounds or lowering the temperature"
        )

    return experiences


# ─── Practice Runner ─────────────────────────────────────────────────────

@dataclass
class PracticeResult:
    total_tasks: int
    total_rounds: int
    success_rate: float
    common_mistakes: dict[str, int]
    experiences: list[str]
    enhanced_prompt: str


async def run_practice(
    model: str,
    rounds: int = 3,
    temperature: float = 0.7,
    experiences: list[str] = None,
    verbose: bool = False,
) -> PracticeResult:
    """Run VFS tool practice rounds and extract experiences."""

    system_prompt = "You are an expert software engineer with access to a Virtual File System (VFS). Use the provided tools to create and modify files."

    # Add existing experiences if provided
    if experiences:
        exp_text = "\n".join(f"- {e}" for e in experiences)
        system_prompt += f"\n\nWhen using VFS tools, follow these rules:\n{exp_text}"

    all_analyses = []

    for round_num in range(rounds):
        print(f"\n{'='*60}")
        print(f"Round {round_num + 1}/{rounds}")
        print(f"{'='*60}")

        round_analyses = []
        for i, (task, expected_tool) in enumerate(VFS_TASKS):
            print(f"  [{i+1}/{len(VFS_TASKS)}] {task[:60]}...")

            response = await run_llm(
                user_message=task,
                system_prompt=system_prompt,
                model=model,
                temperature=temperature,
            )

            analysis = evaluate_tool_calls(task, response)
            round_analyses.append(analysis)

            status = "✅" if analysis.score >= 0.8 else "⚠️" if analysis.score >= 0.5 else "❌"
            print(f"       {status} score={analysis.score:.2f} — {analysis.feedback[:80]}")

        all_analyses.extend(round_analyses)

        # Update system prompt with experiences from this round
        round_experiences = extract_experiences(round_analyses)
        if round_experiences:
            system_prompt += "\n\nAdditional lessons from this round:\n"
            system_prompt += "\n".join(f"- {e}" for e in round_experiences)

    # Final analysis
    successes = sum(1 for a in all_analyses if a.score >= 0.8)
    total = len(all_analyses)

    # Aggregate mistakes
    common_mistakes = {}
    for a in all_analyses:
        for w in a.wrong_tool_names:
            common_mistakes[w] = common_mistakes.get(w, 0) + 1
        for m in a.missing_fields:
            key = f"missing: {m}"
            common_mistakes[key] = common_mistakes.get(key, 0) + 1

    # Final experiences
    final_experiences = extract_experiences(all_analyses)

    # Build enhanced prompt
    enhanced_prompt = build_enhanced_prompt(final_experiences)

    return PracticeResult(
        total_tasks=len(VFS_TASKS),
        total_rounds=rounds,
        success_rate=successes / total if total > 0 else 0,
        common_mistakes=common_mistakes,
        experiences=final_experiences,
        enhanced_prompt=enhanced_prompt,
    )


def build_enhanced_prompt(experiences: list[str]) -> str:
    """Build an enhanced system prompt with VFS tool lessons."""
    prompt = """You are an expert software engineer with access to a Virtual File System (VFS).

## Available Tools
- write_file(path, content, commitMessage?): Create or overwrite a single file
- batch_write(files, commitMessage?): Create multiple files at once
- apply_diff(path, diff, commitMessage?): Apply a unified diff patch
- read_file(path): Read file content
- list_files(path, recursive?): List directory contents

## Rules
"""
    if experiences:
        for i, exp in enumerate(experiences, 1):
            prompt += f"{i}. {exp}\n"
    else:
        prompt += "1. Always use the canonical tool names (write_file, batch_write, apply_diff)\n"
        prompt += "2. Always provide required arguments (path, content for write_file)\n"
        prompt += "3. For batch_write, pass files as a proper JSON array\n"

    return prompt


# ─── CLI ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VFS Tool Call Practice")
    parser.add_argument("--model", default=os.environ.get("UTU_LLM_MODEL", "gpt-4o-mini"),
                        help="Model to practice with")
    parser.add_argument("--rounds", type=int, default=3,
                        help="Number of practice rounds")
    parser.add_argument("--temperature", type=float, default=0.7,
                        help="LLM temperature for rollouts")
    parser.add_argument("--generate-prompt", action="store_true",
                        help="Just output the enhanced system prompt")
    parser.add_argument("--verbose", action="store_true",
                        help="Show detailed output")
    parser.add_argument("--interactive", action="store_true",
                        help="Interactive practice mode")
    args = parser.parse_args()

    # Quick mode: just generate prompt
    if args.generate_prompt:
        prompt = build_enhanced_prompt([
            "Always use write_file, not create_file, saveFile, writeToFile, or writeFile",
            "Always provide path= and content= arguments for write_file",
            "For batch_write, pass files as a JSON array: files=[{path:'...', content:'...'}]",
            "Never stringify the files array — pass it as a proper JSON array",
        ])
        print(prompt)
        return

    if args.interactive:
        print("VFS Tool Practice — Interactive Mode")
        print(f"Model: {args.model}")
        print("Enter a file-writing task, or 'practice' to run all tasks")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            if query.lower() == "practice":
                result = asyncio.run(run_practice(
                    model=args.model, rounds=args.rounds,
                    temperature=args.temperature, verbose=args.verbose,
                ))
                print(f"\nSuccess rate: {result.success_rate:.0%}")
                print(f"Experiences:\n")
                for i, exp in enumerate(result.experiences, 1):
                    print(f"  {i}. {exp}")
            else:
                response = asyncio.run(run_llm(
                    user_message=query,
                    system_prompt=build_enhanced_prompt([]),
                    model=args.model,
                    temperature=args.temperature,
                ))
                analysis = evaluate_tool_calls(query, response)
                print(f"\nScore: {analysis.score:.2f}")
                print(f"Feedback: {analysis.feedback}")
                print(f"\nResponse:\n{response[:500]}")
        return

    # Default: run practice
    print(f"VFS Tool Practice")
    print(f"Model: {args.model}")
    print(f"Rounds: {args.rounds}")
    print(f"Temperature: {args.temperature}")
    print(f"Tasks: {len(VFS_TASKS)}")

    result = asyncio.run(run_practice(
        model=args.model,
        rounds=args.rounds,
        temperature=args.temperature,
        verbose=args.verbose,
    ))

    print(f"\n{'='*60}")
    print(f"RESULTS")
    print(f"{'='*60}")
    print(f"Success rate: {result.success_rate:.0%} ({int(result.success_rate * result.total_tasks * result.total_rounds)}/{result.total_tasks * result.total_rounds})")
    print(f"\nCommon mistakes:")
    for mistake, count in sorted(result.common_mistakes.items(), key=lambda x: -x[1]):
        print(f"  • {mistake} ({count} times)")
    print(f"\nExtracted experiences:")
    for i, exp in enumerate(result.experiences, 1):
        print(f"  {i}. {exp}")
    print(f"\n{'='*60}")
    print(f"ENHANCED SYSTEM PROMPT")
    print(f"{'='*60}\n")
    print(result.enhanced_prompt)

    # Save to file
    output_path = "/tmp/vfs_practice_result.json"
    with open(output_path, "w") as f:
        json.dump({
            "success_rate": result.success_rate,
            "common_mistakes": result.common_mistakes,
            "experiences": result.experiences,
            "enhanced_prompt": result.enhanced_prompt,
        }, f, indent=2)

    print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()
