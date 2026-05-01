"""
Verification function for web search tasks.

Adapted from Youtu-Agent. Uses an LLM judge to evaluate responses.
"""

from .db import EvaluationSample
from ..utils import SimplifiedAsyncOpenAI, FileUtils


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    """Verify web search task responses using LLM-based judgment.

    Args:
        sample: EvaluationSample with raw_question, correct_answer, response
        timeout_score: Score to assign when verification times out
        **kwargs: May include 'llm' for LLM client

    Returns:
        dict with "reward" (0.0-1.0) and optional "reasoning"
    """
    if not sample.response:
        return {"reward": 0.0, "reasoning": "No response provided"}

    if not sample.correct_answer:
        return {"reward": 0.0, "reasoning": "No correct answer available"}

    # Use LLM from kwargs or create one
    llm = kwargs.get("llm")
    if llm is None:
        try:
            llm = SimplifiedAsyncOpenAI()
        except Exception:
            return {"reward": 0.0, "reasoning": "LLM not available for verification"}

    # Load judge prompt
    prompts = FileUtils.load_prompts("experience.yaml")
    judge_prompt = prompts.get("judge", {}).get("user", "").format(
        question=sample.raw_question,
        ground_truth=sample.correct_answer,
        response=sample.response,
    )

    if not judge_prompt:
        # Fallback: simple keyword matching
        response_lower = sample.response.lower()
        answer_lower = sample.correct_answer.lower()
        # Check if key entities from the answer appear in the response
        key_terms = [t.strip() for t in answer_lower.split() if len(t.strip()) > 3]
        matches = sum(1 for t in key_terms if t in response_lower)
        score = matches / len(key_terms) if key_terms else 0.0
        return {"reward": min(score, 1.0), "reasoning": f"Keyword match: {matches}/{len(key_terms)}"}

    try:
        import asyncio

        async def _judge():
            result = await llm.chat_completion(
                messages=[{"role": "user", "content": judge_prompt}],
                temperature=0.5,
            )
            return result

        response = asyncio.get_event_loop().run_until_complete(_judge())

        # Parse the LLM response for a score
        response_lower = response.lower()
        if "incorrect" in response_lower or "no" in response_lower or "0" in response_lower:
            return {"reward": 0.0, "reasoning": response[:200]}
        elif "correct" in response_lower or "yes" in response_lower or "1" in response_lower:
            return {"reward": 1.0, "reasoning": response[:200]}
        else:
            # Try to extract a numeric score
            import re
            match = re.search(r'(\d+\.?\d*)', response)
            if match:
                score = float(match.group(1))
                return {"reward": min(score / 100.0, 1.0), "reasoning": response[:200]}
            return {"reward": 0.5, "reasoning": f"Ambiguous judgment: {response[:200]}"}

    except Exception as e:
        return {"reward": 0.0, "reasoning": f"Judge error: {str(e)}"}
