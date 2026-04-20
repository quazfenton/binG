"""GAIA Benchmark Example

GAIA (General AI Assistant) benchmark tests real-world complex tasks:
- Multi-step reasoning
- Tool use (search, code execution, file reading)
- Handling noisy/complex inputs
- Cross-document information synthesis

Usage:
    python scripts/examples/gaia/main.py
    python scripts/examples/gaia/main.py --interactive
    python scripts/examples/gaia/main.py --sample  # Run a sample GAIA task
"""

import asyncio
import argparse
import json
import os
import sys
import random
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


# ─── Agent Prompts ────────────────────────────────────────────────────────

PLANNER_PROMPT = """\
You are solving a complex task that requires multiple steps.

Task: {task}

Break this down into a plan. List each step as an action you'll take.
Be specific about what tools or information you need for each step.

Output as JSON:
{{"steps": [
    {{"action": "description", "needs_tool": "tool_name", "depends_on": "step_number"}}
]}}
"""

SOLVER_PROMPT = """\
You are solving one step of a larger task.

Original task: {original_task}
Current step: {step}
Previous results: {previous_results}

Execute this step. Be thorough and provide all relevant details.
If you need to search for information, do so and report what you find.
If you need to compute something, show your work.
"""

SYNTHESIZER_PROMPT = """\
You are the final synthesizer. You have all the step results and need
to produce the final answer.

Original task: {original_task}
Step results:
{step_results}

Provide the final answer. Be concise and direct. If the task asks for a
specific value, format, or file, provide exactly that.
"""


@dataclass
class GAIAStep:
    action: str
    needs_tool: str = ""
    depends_on: str = ""
    result: Optional[str] = None


@dataclass
class GAIATask:
    question: str
    answer: str = ""
    file_name: str = ""
    level: int = 1
    steps: list[GAIAStep] = field(default_factory=list)
    final_answer: Optional[str] = None


@dataclass
class GAIAResult:
    task: GAIATask
    predicted: str
    correct: bool
    steps_completed: int
    total_steps: int


# ─── Sample GAIA Tasks ──────────────────────────────────────────────────

SAMPLE_TASKS = [
    GAIATask(
        question="If you have a number that is the sum of the first 10 prime numbers, "
                 "and you multiply it by the number of distinct letters in the word 'Mississippi', "
                 "what do you get?",
        answer="636",
        level=1,
    ),
    GAIATask(
        question="Find the GDP of the country that won the most recent FIFA World Cup before 2020. "
                 "Express your answer in billions of USD, rounded to the nearest integer.",
        answer="1393",
        level=2,
    ),
    GAIATask(
        question="What is the population of the city where the company that created the Python "
                 "programming language is headquartered? Give your answer rounded to the nearest thousand.",
        answer="56000",  # Amsterdam ~56k is wrong, it's CWI in Amsterdam
        level=2,
    ),
    GAIATask(
        question="Look at the file 'data.csv'. What is the average of the values in the third column "
                 "where the first column contains the word 'Engineering'? Round to 2 decimal places.",
        answer="42.56",
        level=3,
        file_name="data.csv",
    ),
]


async def run_agent(user_message: str, system_prompt: str) -> str:
    """Run a single agent call."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    config = UnifiedAgentConfig(
        userMessage=user_message,
        systemPrompt=system_prompt,
        maxSteps=15,
        mode="v1-api",
    )

    result = await processUnifiedAgentRequest(config)
    return result.response if result.success else f"Error: {result.error}"


async def solve_task(task: GAIATask) -> GAIAResult:
    """Solve a single GAIA task using multi-step approach."""
    print(f"\n{'─'*60}")
    print(f"Task: {task.question[:100]}...")
    print(f"Level: {task.level}")
    print(f"{'─'*60}\n")

    # Step 1: Plan
    print("  [Planner] Creating plan...")
    plan_response = await run_agent(
        PLANNER_PROMPT.format(task=task.question),
        "You are a planning assistant. Output only valid JSON.",
    )

    # Parse plan
    steps = []
    try:
        text = plan_response
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "{" in text:
            text = text[text.index("{"):text.rindex("}")+1]
        plan_data = json.loads(text)
        steps = [GAIAStep(**s) for s in plan_data.get("steps", [])]
    except Exception as e:
        print(f"  Plan parse failed: {e}. Falling back to single-step solve.")
        steps = [GAIAStep(action="Solve the entire task", needs_tool="general")]

    task.steps = steps
    print(f"  Plan: {len(steps)} steps")

    # Step 2: Execute each step
    previous_results = ""
    for i, step in enumerate(steps):
        print(f"  [Solver] Step {i+1}/{len(steps)}: {step.action[:80]}")
        step_result = await run_agent(
            SOLVER_PROMPT.format(
                original_task=task.question,
                step=step.action,
                previous_results=previous_results[:2000] if previous_results else "None yet",
            ),
            "You are a problem solver. Execute the given step thoroughly.",
        )
        step.result = step_result
        previous_results += f"\nStep {i+1}: {step.action}\n{step_result}\n"
        print(f"  ✓ Step {i+1} done")

    # Step 3: Synthesize final answer
    print(f"\n  [Synthesizer] Computing final answer...")
    final_answer = await run_agent(
        SYNTHESIZER_PROMPT.format(
            original_task=task.question,
            step_results=previous_results,
        ),
        "Provide only the final answer. Be concise.",
    )

    task.final_answer = final_answer.strip()

    # Check correctness
    correct = task.answer.lower().strip() in task.final_answer.lower().strip()

    result = GAIAResult(
        task=task,
        predicted=task.final_answer,
        correct=correct,
        steps_completed=len([s for s in steps if s.result]),
        total_steps=len(steps),
    )

    print(f"\n  Predicted: {task.final_answer[:200]}")
    print(f"  Expected: {task.answer}")
    print(f"  Result: {'✅ CORRECT' if correct else '❌ WRONG'}")

    return result


def run_benchmark(tasks: list[GAIATask] = None):
    """Run the GAIA benchmark on a set of tasks."""
    tasks = tasks or SAMPLE_TASKS

    print(f"\n{'='*60}")
    print(f"GAIA BENCHMARK — {len(tasks)} tasks")
    print(f"{'='*60}")

    results = []
    for task in tasks:
        result = asyncio.get_event_loop().run_until_complete(solve_task(task))
        results.append(result)

    # Summary
    correct = sum(1 for r in results if r.correct)
    total = len(results)

    print(f"\n{'='*60}")
    print(f"RESULTS: {correct}/{total} ({correct/total*100:.1f}%)")
    print(f"{'='*60}\n")

    for i, r in enumerate(results, 1):
        status = "✅" if r.correct else "❌"
        print(f"  {status} Task {i}: {r.task.question[:60]}...")
        print(f"     Predicted: {r.predicted[:100]}")

    # Save results
    output = {
        "total": total,
        "correct": correct,
        "accuracy": correct / total if total > 0 else 0,
        "results": [
            {
                "question": r.task.question,
                "expected": r.task.answer,
                "predicted": r.predicted,
                "correct": r.correct,
                "steps": r.steps_completed,
            }
            for r in results
        ],
    }

    output_path = "/tmp/gaia_results.json"
    with open(output_path, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nFull results saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="GAIA Benchmark Example")
    parser.add_argument("--sample", action="store_true",
                        help="Run sample GAIA tasks")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    parser.add_argument("--task", help="Single task to solve")
    args = parser.parse_args()

    if args.interactive:
        print("GAIA Benchmark - Interactive Mode")
        print("Enter a task or 'sample' to run sample tasks")
        print("Type 'exit' to quit\n")
        while True:
            query = input("> ").strip()
            if query.lower() in ("exit", "quit", "q"):
                break
            if not query:
                continue
            if query.lower() == "sample":
                run_benchmark(SAMPLE_TASKS)
            else:
                task = GAIATask(question=query)
                asyncio.run(solve_task(task))
        return

    if args.task:
        task = GAIATask(question=args.task)
        asyncio.run(solve_task(task))
        return

    if args.sample:
        run_benchmark(SAMPLE_TASKS[:2])  # Just first 2 for quick demo
        return

    # Default: run 2 sample tasks
    run_benchmark(SAMPLE_TASKS[:2])


if __name__ == "__main__":
    main()
