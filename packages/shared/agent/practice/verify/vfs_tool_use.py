"""
Verification function for VFS MCP tool usage tasks.

Checks whether the agent correctly used VFS MCP tools (write_file, batch_write,
apply_diff) to create/modify files as requested.

This verifier evaluates:
1. Did the agent attempt to use VFS tools?
2. Were the tool calls correctly structured?
3. Did the file operations succeed?
4. Does the resulting file content match expectations?
"""

from __future__ import annotations

import re
from pathlib import Path

from .db import EvaluationSample


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    """Verify VFS tool usage correctness.

    Args:
        sample: EvaluationSample with:
            - raw_question: The task description
            - correct_answer: Expected tool call pattern
            - response: Agent's response (may include tool call traces)
            - trajectory: Full agent trajectory if available
            - metadata: Additional context (e.g., tool_calls made)
        timeout_score: Score to assign when verification times out
        **kwargs: May include 'llm' for LLM-based judgment

    Returns:
        dict: {"reward": 0.0-1.0, "reasoning": "explanation"}
    """
    if not sample.response:
        return {"reward": 0.0, "reasoning": "No response — agent did not attempt the task"}

    response = sample.response
    question = sample.raw_question
    expected = sample.correct_answer or ""

    score = 0.0
    reasons = []

    # ─── Criterion 1: Did the agent attempt file operations? ─────────────
    file_indicators = [
        "write_file", "batch_write", "apply_diff", "read_file",
        "writeFile", "batchWrite", "applyDiff", "readFile",
        "Tool call", "tool_call", "toolCall",
        "```python", "```javascript", "```typescript",
        "Created file", "Wrote file", "Updated file",
        "File created", "File written",
    ]
    used_tools = any(ind in response for ind in file_indicators)

    if used_tools:
        score += 0.2
        reasons.append("✓ Attempted tool usage")
    else:
        reasons.append("✗ No tool usage detected")
        return {"reward": 0.0, "reasoning": "; ".join(reasons)}

    # ─── Criterion 2: Correct tool name resolution ───────────────────────
    # Check for common tool name mistakes that smaller models make
    wrong_tool_names = [
        "createFile", "create_file",   # wrong names
        "writeToFile", "write-to-file",
        "save_file", "saveFile",
        "make_file", "makeFile",
    ]
    used_wrong = any(w in response.lower() for w in [r.lower() for r in wrong_tool_names])

    if used_wrong:
        reasons.append("⚠ Used incorrect tool name (should be write_file/batch_write/apply_diff)")
        score += 0.05  # partial credit for attempting
    else:
        score += 0.15
        reasons.append("✓ Correct tool names used")

    # ─── Criterion 3: Correct argument structure ─────────────────────────
    # Check for correct argument patterns: path=, content=, files=
    has_path = bool(re.search(r'path\s*[=:]\s*["\']', response))
    has_content = bool(re.search(r'content\s*[=:]\s*["\']', response))
    has_files_arg = bool(re.search(r'files\s*[=:]\s*\[', response))

    if "batch" in expected.lower() or "multiple" in question.lower():
        # Should use batch_write with files=
        if has_files_arg:
            score += 0.25
            reasons.append("✓ Correct batch_write structure")
        elif has_path and has_content:
            score += 0.15
            reasons.append("⚠ Used individual write_file instead of batch_write (less efficient but valid)")
        else:
            reasons.append("✗ Missing required arguments for batch_write")
    else:
        # Should use write_file with path= and content=
        if has_path and has_content:
            score += 0.25
            reasons.append("✓ Correct write_file structure (path + content)")
        elif has_path:
            score += 0.1
            reasons.append("⚠ Provided path but missing content")
        else:
            reasons.append("✗ Missing required 'path' argument")

    # ─── Criterion 4: File content quality ───────────────────────────────
    # If the response includes actual file content, check it's non-empty
    # and looks like valid code/config
    code_block = re.search(r'```(?:\w+)?\s*\n(.*?)```', response, re.DOTALL)
    if code_block:
        content = code_block.group(1).strip()
        if len(content) > 10:
            score += 0.15
            reasons.append("✓ Substantial file content generated")
        else:
            reasons.append("⚠ File content too short")
    else:
        # Check if response mentions file content inline
        if len(response) > 50:
            score += 0.1
            reasons.append("⚠ File content present but not in code block")

    # ─── Criterion 5: Task completion ────────────────────────────────────
    # Check if the response indicates successful completion
    completion_indicators = [
        "File created", "File written", "created successfully",
        "has been created", "has been written", "successfully created",
        "done", "complete", "finished",
    ]
    completed = any(ind in response.lower() for ind in completion_indicators)

    if completed:
        score += 0.2
        reasons.append("✓ Task reported as complete")
    else:
        reasons.append("⚠ No completion indicator found")

    # ─── LLM-based judgment (fallback for ambiguous cases) ───────────────
    # If score is in a gray area, use LLM to make final call
    llm = kwargs.get("llm")
    if 0.3 < score < 0.8 and llm:
        import asyncio

        judge_prompt = f"""Evaluate whether the agent successfully completed this file-writing task.

Task: {question}
Expected pattern: {expected}
Agent response:
{response[:3000]}

Score from 0 to 1:
- 1.0: Correct tool usage, proper arguments, valid content
- 0.5: Partial success (some tools correct, some wrong)
- 0.0: Failed (wrong tools, missing arguments, no content)

Respond with just the number and a one-line reason."""

        try:
            async def _judge():
                result = await llm.chat_completion(
                    messages=[{"role": "user", "content": judge_prompt}],
                    temperature=0.3,
                )
                return result

            llm_response = asyncio.get_event_loop().run_until_complete(_judge())
            # Try to extract a numeric score
            match = re.search(r'([0-9]*\.?[0-9]+)', llm_response)
            if match:
                llm_score = float(match.group(1))
                # Blend: 60% rule-based, 40% LLM
                score = 0.6 * score + 0.4 * llm_score
                reasons.append(f"LLM judgment: {llm_response[:100]}")
        except Exception as e:
            reasons.append(f"LLM judgment failed: {e}")

    # ─── Final scoring ───────────────────────────────────────────────────
    # Threshold: 0.7+ is a success, 0.3-0.7 is partial, below 0.3 is failure
    reward = min(max(score, 0.0), 1.0)

    if reward >= 0.7:
        reward = 1.0
    elif reward >= 0.4:
        reward = 0.5
    else:
        reward = 0.0

    return {
        "reward": reward,
        "reasoning": "; ".join(reasons),
    }
