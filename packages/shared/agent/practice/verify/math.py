"""
Verification function for math problems.

Adapted from Youtu-Agent. Uses math_verify for symbolic math comparison.
"""

from .db import EvaluationSample


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    """Verify mathematical problem solutions.

    Args:
        sample: EvaluationSample with raw_question, correct_answer, response
        timeout_score: Score to assign when verification times out
        **kwargs: Additional arguments (may include llm for LLM-based judgment)

    Returns:
        dict with "reward" (0.0-1.0) and optional "reasoning"
    """
    if not sample.response:
        return {"reward": 0.0, "reasoning": "No response provided"}

    if not sample.correct_answer:
        return {"reward": 0.0, "reasoning": "No correct answer available"}

    try:
        from math_verify.errors import TimeoutException
        from math_verify.metric import math_metric
        from math_verify.parser import ExprExtractionConfig, LatexExtractionConfig

        result = math_metric(
            [sample.correct_answer],
            [sample.response],
            extraction_config=[ExprExtractionConfig(), LatexExtractionConfig()],
        )

        if result.value > 0.5:
            return {"reward": 1.0, "reasoning": "Solution matches ground truth"}
        else:
            return {"reward": 0.0, "reasoning": "Solution does not match"}

    except ImportError:
        # Fallback to simple string matching
        import re
        response_clean = sample.response.strip().lower()
        answer_clean = sample.correct_answer.strip().lower()
        # Use word boundaries to avoid partial matches (e.g., '1' matching '10')
        pattern = r'\b' + re.escape(answer_clean) + r'\b'
        if response_clean == answer_clean or re.search(pattern, response_clean):
            return {"reward": 1.0, "reasoning": "String match"}
        return {"reward": 0.0, "reasoning": "No match (math_verify not installed)"}
    except TimeoutException:
        return {"reward": timeout_score, "reasoning": "Verification timed out"}
    except Exception as e:
        return {"reward": 0.0, "reasoning": f"Verification error: {str(e)}"}
