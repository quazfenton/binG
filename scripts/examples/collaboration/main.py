"""Multi-Agent Collaboration Example

Demonstrates how multiple agents can collaborate on a complex task:
- Coder: writes code
- Reviewer: reviews code for correctness, style, security
- Tester: writes and runs tests
- Final reviewer: approves or requests changes

Usage:
    python scripts/examples/collaboration/main.py
    python scripts/examples/collaboration/main.py --task "Write a binary search tree in Python"
    python scripts/examples/collaboration/main.py --interactive
"""

import asyncio
import argparse
import sys
from pathlib import Path

# Add project root
project_root = str(Path(__file__).parent.parent.parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


# ─── Agent Prompts ────────────────────────────────────────────────────────

CODER_PROMPT = """\
You are an expert software engineer. Write clean, correct, efficient code.

Rules:
- Follow language best practices and idioms
- Include type hints and docstrings
- Handle edge cases and errors
- Keep it concise but readable
- Output code in ```language...``` blocks
"""

REVIEWER_PROMPT = """\
You are a senior code reviewer. Review code for:

1. **Correctness**: Does it work as intended? Any bugs?
2. **Style**: Is it idiomatic? Well-formatted? Named well?
3. **Security**: Any vulnerabilities? Injection risks?
4. **Performance**: Any obvious optimizations?
5. **Maintainability**: Is it easy to understand and extend?

Output a review with:
- ✅ Things done well
- ⚠️ Issues to fix (must be specific and actionable)
- Overall: APPROVE or REQUEST_CHANGES

If REQUEST_CHANGES, list exactly what needs to change.
"""

TESTER_PROMPT = """\
You are an expert test engineer. Write comprehensive tests for the given code.

Requirements:
- Cover normal cases, edge cases, and error cases
- Use the standard testing framework for the language
- Include clear test names
- Tests should be runnable
- Output test code in ```language...``` blocks
"""

FINAL_REVIEWER_PROMPT = """\
You are the final decision maker. Given the code, reviews, and tests,
decide whether the contribution is ready to merge.

Output APPROVE or REQUEST_CHANGES with a brief summary.
"""


async def run_agent(user_message: str, system_prompt: str, max_steps: int = 10):
    """Run a single agent with the unified agent service."""
    from web.lib.orchestra.unified_agent_service import (
        processUnifiedAgentRequest,
        UnifiedAgentConfig,
    )

    config = UnifiedAgentConfig(
        userMessage=user_message,
        systemPrompt=system_prompt,
        maxSteps=max_steps,
        mode="v1-api",
    )

    return await processUnifiedAgentRequest(config)


async def collaboration_loop(task: str, max_rounds: int = 3):
    """Run a multi-agent collaboration loop.

    Flow:
    1. Coder writes initial implementation
    2. Reviewer reviews the code
    3. If REQUEST_CHANGES, coder fixes and re-review (up to max_rounds)
    4. Tester writes tests for approved code
    5. Final reviewer approves or requests changes
    """
    print(f"\n{'='*60}")
    print(f"Task: {task}")
    print(f"{'='*60}\n")

    # ─── Round 1: Initial Code ──────────────────────────────────────────
    print("  [Coder] Writing initial implementation...")
    code_result = await run_agent(task, CODER_PROMPT)
    if not code_result.success:
        print(f"  ✗ Coder failed: {code_result.error}")
        return

    code = code_result.response
    print(f"  ✓ Code written ({len(code)} chars)")

    # ─── Code Review ────────────────────────────────────────────────────
    for round_num in range(1, max_rounds + 1):
        print(f"\n  [Reviewer] Round {round_num} review...")
        review_result = await run_agent(
            f"Review this code:\n\n{code}",
            REVIEWER_PROMPT,
        )

        if not review_result.success:
            print(f"  ✗ Reviewer failed: {review_result.error}")
            break

        review = review_result.response
        print(f"  Review: {review[:300]}...")

        # Check if changes requested
        if "REQUEST_CHANGES" in review.upper():
            if round_num >= max_rounds:
                print(f"\n  ⚠️  Max review rounds ({max_rounds}) reached. Proceeding with tests.")
                break

            # Extract requested changes
            print(f"  [Coder] Fixing issues (round {round_num + 1})...")
            code_result = await run_agent(
                f"Original code:\n{code}\n\nReview feedback:\n{review}\n\nFix the issues.",
                CODER_PROMPT,
            )

            if code_result.success:
                code = code_result.response
                print(f"  ✓ Code updated")
            else:
                print(f"  ✗ Coder fix failed: {code_result.error}")
                break
        else:
            print(f"  ✓ Code APPROVED by reviewer")
            break

    # ─── Testing ─────────────────────────────────────────────────────────
    print(f"\n  [Tester] Writing tests...")
    test_result = await run_agent(
        f"Write tests for this code:\n\n{code}",
        TESTER_PROMPT,
    )

    if test_result.success:
        tests = test_result.response
        print(f"  ✓ Tests written ({len(tests)} chars)")

        # Run review on tests too
        print(f"  [Reviewer] Reviewing tests...")
        test_review = await run_agent(
            f"Review these tests:\n\n{tests}",
            REVIEWER_PROMPT,
        )
        if test_review.success:
            print(f"  Test review: {test_review.response[:200]}...")
    else:
        tests = ""
        print(f"  ✗ Test writing failed: {test_result.error}")

    # ─── Final Decision ──────────────────────────────────────────────────
    print(f"\n  [Final] Making merge decision...")
    final_result = await run_agent(
        f"Code:\n{code}\n\nTests:\n{tests}",
        FINAL_REVIEWER_PROMPT,
    )

    if final_result.success:
        final = final_result.response
        print(f"\n{'='*60}")
        print(f"FINAL DECISION")
        print(f"{'='*60}\n")
        print(final)

    # ─── Summary ─────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"{'='*60}\n")
    print(f"Code: {len(code)} chars")
    print(f"Tests: {len(tests)} chars")
    print(f"Review rounds: {min(round_num + 1, max_rounds)}")


def main():
    parser = argparse.ArgumentParser(description="Multi-Agent Collaboration Example")
    parser.add_argument("--task", help="Task for the coder agent")
    parser.add_argument("--max-rounds", type=int, default=3,
                        help="Maximum review rounds")
    parser.add_argument("--interactive", action="store_true",
                        help="Run in interactive mode")
    args = parser.parse_args()

    if args.interactive:
        print("Multi-Agent Collaboration - Interactive Mode")
        print("Give the agents a coding task")
        print("Type 'exit' to quit\n")
        while True:
            task = input("> ").strip()
            if task.lower() in ("exit", "quit", "q"):
                break
            if not task:
                continue
            asyncio.run(collaboration_loop(task, max_rounds=args.max_rounds))
        return

    if args.task:
        asyncio.run(collaboration_loop(args.task, max_rounds=args.max_rounds))
    else:
        # Default task
        asyncio.run(collaboration_loop(
            "Write a thread-safe LRU cache in Python with get and put operations. O(1) time complexity for both.",
            max_rounds=args.max_rounds,
        ))


if __name__ == "__main__":
    main()
