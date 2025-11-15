"""
Fast-Agent Workflow: Evaluator
Evaluate and score agent outputs for quality assessment
"""

from typing import List, Dict, Any, Optional, Callable
import asyncio
import httpx
import re
from datetime import datetime
from enum import Enum


class EvaluationMetric(Enum):
    """Evaluation metrics"""
    ACCURACY = "accuracy"
    COMPLETENESS = "completeness"
    RELEVANCE = "relevance"
    CLARITY = "clarity"
    CORRECTNESS = "correctness"
    SAFETY = "safety"
    CUSTOM = "custom"


class EvaluatorConfig:
    """Configuration for evaluator"""
    def __init__(
        self,
        metrics: List[EvaluationMetric],
        threshold: float = 0.7,
        use_llm_judge: bool = True,
        judge_model: str = "gpt-4",
        custom_evaluators: Optional[Dict[str, Callable]] = None
    ):
        self.metrics = metrics
        self.threshold = threshold
        self.use_llm_judge = use_llm_judge
        self.judge_model = judge_model
        self.custom_evaluators = custom_evaluators or {}


class AgentEvaluator:
    """Evaluate agent outputs"""
    
    def __init__(self, config: EvaluatorConfig, base_url: str = None):
        self.config = config
        self.base_url = base_url or "https://fast-agent.yourdomain.com/api/chat"
        self.client = httpx.AsyncClient(timeout=30)
    
    async def evaluate(
        self,
        output: str,
        expected: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Evaluate output quality"""
        
        scores = {}
        
        for metric in self.config.metrics:
            if metric == EvaluationMetric.CUSTOM:
                # Use custom evaluators
                for name, evaluator in self.config.custom_evaluators.items():
                    scores[name] = await self._evaluate_custom(
                        output, expected, context or {}, evaluator
                    )
            elif self.config.use_llm_judge:
                # Use LLM as judge
                scores[metric.value] = await self._evaluate_with_llm(
                    output, expected, metric, context or {}
                )
            else:
                # Use heuristic evaluation
                scores[metric.value] = self._evaluate_heuristic(
                    output, expected, metric
                )
        
        # Calculate overall score
        overall_score = sum(scores.values()) / len(scores) if scores else 0.0
        
        # Determine if passed threshold
        passed = overall_score >= self.config.threshold
        
        return {
            "scores": scores,
            "overall_score": overall_score,
            "passed": passed,
            "threshold": self.config.threshold,
            "timestamp": datetime.now().isoformat()
        }
    
    async def evaluate_with_llm(
        self,
        output: str,
        expected: Optional[str],
        metric: EvaluationMetric,
        context: Dict[str, Any]
    ) -> float:
        """Evaluate using LLM as judge"""
        
        prompt = self._build_judge_prompt(output, expected, metric, context)
        
        payload = {
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert evaluator. Rate the output on a scale of 0.0 to 1.0. Respond with only the numeric score."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "model": self.config.judge_model,
            "temperature": 0.1,
            "max_tokens": 10
        }
        
        try:
            response = await self.client.post(
                self.base_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            
            result = response.json()
            score_text = result.get("content", "0.5")
            
            # Extract numeric score
            match = re.search(r"(\d+\.?\d*)", score_text)
            if match:
                score = float(match.group(1))
                return min(max(score, 0.0), 1.0)  # Clamp between 0 and 1
            
            return 0.5  # Default if parsing fails
            
        except Exception as e:
            print(f"LLM judge error: {e}")
            return 0.5
    
    def _build_judge_prompt(
        self,
        output: str,
        expected: Optional[str],
        metric: EvaluationMetric,
        context: Dict[str, Any]
    ) -> str:
        """Build evaluation prompt for LLM judge"""
        
        base_prompt = f"Evaluate the following output for {metric.value}:\n\n"
        base_prompt += f"Output:\n{output}\n\n"
        
        if expected:
            base_prompt += f"Expected:\n{expected}\n\n"
        
        if context:
            base_prompt += f"Context:\n{context}\n\n"
        
        if metric == EvaluationMetric.ACCURACY:
            base_prompt += "Rate how accurate and factually correct the output is (0.0-1.0):"
        elif metric == EvaluationMetric.COMPLETENESS:
            base_prompt += "Rate how complete and comprehensive the output is (0.0-1.0):"
        elif metric == EvaluationMetric.RELEVANCE:
            base_prompt += "Rate how relevant the output is to the request (0.0-1.0):"
        elif metric == EvaluationMetric.CLARITY:
            base_prompt += "Rate how clear and well-structured the output is (0.0-1.0):"
        elif metric == EvaluationMetric.CORRECTNESS:
            base_prompt += "Rate the correctness of the output (0.0-1.0):"
        elif metric == EvaluationMetric.SAFETY:
            base_prompt += "Rate how safe and appropriate the output is (0.0-1.0):"
        
        return base_prompt
    
    def _evaluate_heuristic(
        self,
        output: str,
        expected: Optional[str],
        metric: EvaluationMetric
    ) -> float:
        """Heuristic evaluation without LLM"""
        
        if metric == EvaluationMetric.COMPLETENESS:
            # Check length and structure
            score = 0.0
            if len(output) > 50:
                score += 0.3
            if len(output) > 200:
                score += 0.3
            if output.count('\n') > 2:
                score += 0.2
            if any(marker in output for marker in ['1.', '2.', '-', '*']):
                score += 0.2
            return min(score, 1.0)
        
        elif metric == EvaluationMetric.CLARITY:
            # Check readability
            words = output.split()
            score = 0.5
            
            if len(words) > 10:
                score += 0.2
            if output.count('.') > 1:
                score += 0.1
            if not any(char in output for char in ['???', '...', 'unclear']):
                score += 0.2
            
            return min(score, 1.0)
        
        elif metric == EvaluationMetric.ACCURACY and expected:
            # Simple similarity check
            output_words = set(output.lower().split())
            expected_words = set(expected.lower().split())
            
            if not expected_words:
                return 0.5
            
            overlap = len(output_words & expected_words)
            return overlap / len(expected_words)
        
        # Default score for other metrics
        return 0.5
    
    async def _evaluate_custom(
        self,
        output: str,
        expected: Optional[str],
        context: Dict[str, Any],
        evaluator: Callable
    ) -> float:
        """Run custom evaluator"""
        try:
            if asyncio.iscoroutinefunction(evaluator):
                return await evaluator(output, expected, context)
            else:
                return evaluator(output, expected, context)
        except Exception as e:
            print(f"Custom evaluator error: {e}")
            return 0.0
    
    async def compare_outputs(
        self,
        outputs: List[Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Compare multiple outputs and rank them"""
        
        evaluations = []
        
        for idx, item in enumerate(outputs):
            output = item.get("output", "")
            expected = item.get("expected")
            
            eval_result = await self.evaluate(output, expected, context)
            eval_result["index"] = idx
            eval_result["agent"] = item.get("agent", "unknown")
            evaluations.append(eval_result)
        
        # Sort by score
        ranked = sorted(evaluations, key=lambda x: x["overall_score"], reverse=True)
        
        return {
            "evaluations": evaluations,
            "ranked": ranked,
            "best": ranked[0] if ranked else None,
            "worst": ranked[-1] if ranked else None
        }
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


# Example usage patterns
async def example_code_evaluation():
    """Example: Evaluate code quality"""
    
    def check_code_quality(output: str, expected: str, context: Dict[str, Any]) -> float:
        """Custom code quality checker"""
        score = 0.0
        
        # Check for common patterns
        if "def " in output or "function " in output:
            score += 0.3
        if "try" in output or "catch" in output or "except" in output:
            score += 0.2
        if "class " in output:
            score += 0.2
        if len(output) > 100:
            score += 0.3
        
        return min(score, 1.0)
    
    config = EvaluatorConfig(
        metrics=[EvaluationMetric.COMPLETENESS, EvaluationMetric.CORRECTNESS, EvaluationMetric.CUSTOM],
        threshold=0.75,
        use_llm_judge=True,
        custom_evaluators={"code_quality": check_code_quality}
    )
    
    evaluator = AgentEvaluator(config)
    
    code_output = """
    def fibonacci(n):
        if n <= 1:
            return n
        return fibonacci(n-1) + fibonacci(n-2)
    """
    
    result = await evaluator.evaluate(code_output, context={"task": "implement fibonacci"})
    await evaluator.close()
    return result


async def example_compare_agents():
    """Example: Compare outputs from multiple agents"""
    config = EvaluatorConfig(
        metrics=[EvaluationMetric.ACCURACY, EvaluationMetric.COMPLETENESS, EvaluationMetric.CLARITY],
        threshold=0.7,
        use_llm_judge=False  # Use heuristics for speed
    )
    
    evaluator = AgentEvaluator(config)
    
    outputs = [
        {
            "agent": "agent-1",
            "output": "The sky is blue due to Rayleigh scattering of sunlight.",
            "expected": "Explain why the sky is blue"
        },
        {
            "agent": "agent-2",
            "output": "Blue sky happens because of light scattering in atmosphere.",
            "expected": "Explain why the sky is blue"
        },
        {
            "agent": "agent-3",
            "output": "The sky appears blue because shorter wavelengths of light are scattered more by atmospheric molecules, and blue has a shorter wavelength than other visible colors.",
            "expected": "Explain why the sky is blue"
        }
    ]
    
    comparison = await evaluator.compare_outputs(outputs)
    await evaluator.close()
    return comparison


async def example_quality_gate():
    """Example: Use evaluator as quality gate"""
    config = EvaluatorConfig(
        metrics=[EvaluationMetric.SAFETY, EvaluationMetric.CORRECTNESS],
        threshold=0.8,
        use_llm_judge=True
    )
    
    evaluator = AgentEvaluator(config)
    
    output = "Here's how to create a secure password hash..."
    
    eval_result = await evaluator.evaluate(output)
    
    if eval_result["passed"]:
        print("✅ Output passed quality gate")
        return output
    else:
        print("❌ Output failed quality gate - regenerating...")
        # Trigger regeneration logic
        return None


if __name__ == "__main__":
    asyncio.run(example_code_evaluation())
