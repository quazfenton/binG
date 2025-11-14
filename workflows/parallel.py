"""
Fast-Agent Workflow: Parallel Execution
Run multiple agents concurrently and aggregate results
"""

from typing import List, Dict, Any, Optional, Callable
import asyncio
import httpx
from datetime import datetime
from enum import Enum


class AggregationStrategy(Enum):
    """Strategy for aggregating parallel results"""
    FIRST = "first"  # Return first completed
    ALL = "all"  # Return all results
    BEST = "best"  # Select best based on scorer
    VOTE = "vote"  # Majority voting
    MERGE = "merge"  # Merge all outputs


class ParallelConfig:
    """Configuration for parallel agent execution"""
    def __init__(
        self,
        agents: List[Dict[str, Any]],
        aggregation: AggregationStrategy = AggregationStrategy.ALL,
        timeout: int = 30,
        max_concurrent: int = 5,
        fail_fast: bool = False,
        scorer: Optional[Callable] = None
    ):
        self.agents = agents
        self.aggregation = aggregation
        self.timeout = timeout
        self.max_concurrent = max_concurrent
        self.fail_fast = fail_fast
        self.scorer = scorer


class ParallelAgents:
    """Execute multiple Fast-Agent calls in parallel"""
    
    def __init__(self, config: ParallelConfig, base_url: str = None):
        self.config = config
        self.base_url = base_url or "https://fast-agent.yourdomain.com/api/chat"
        self.client = httpx.AsyncClient(timeout=config.timeout)
    
    async def execute(
        self,
        input_text: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute agents in parallel"""
        semaphore = asyncio.Semaphore(self.config.max_concurrent)
        
        async def execute_with_semaphore(agent_config):
            async with semaphore:
                return await self._execute_agent(input_text, agent_config, context or {})
        
        # Create tasks
        tasks = [
            execute_with_semaphore(agent_config)
            for agent_config in self.config.agents
        ]
        
        # Execute based on strategy
        if self.config.fail_fast:
            results = await self._execute_fail_fast(tasks)
        else:
            results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        processed_results = self._process_results(results)
        
        # Aggregate
        aggregated = self._aggregate_results(processed_results)
        
        return {
            "success": aggregated is not None,
            "strategy": self.config.aggregation.value,
            "results": processed_results,
            "aggregated": aggregated,
            "timestamp": datetime.now().isoformat()
        }
    
    async def _execute_fail_fast(self, tasks):
        """Execute tasks and return as soon as first succeeds"""
        for coro in asyncio.as_completed(tasks):
            try:
                result = await coro
                if not isinstance(result, Exception):
                    return [result]
            except Exception:
                continue
        return []
    
    async def _execute_agent(
        self,
        input_text: str,
        agent_config: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a single agent call"""
        agent_name = agent_config.get("name", "unnamed")
        
        try:
            # Prepare input with agent-specific prompt
            agent_prompt = agent_config.get("prompt_template", "{input}")
            formatted_input = agent_prompt.format(input=input_text, **context)
            
            payload = {
                "messages": [
                    {"role": "user", "content": formatted_input}
                ],
                "model": agent_config.get("model", "default"),
                "temperature": agent_config.get("temperature", 0.7),
                "max_tokens": agent_config.get("max_tokens", 2000),
                **agent_config.get("extra_params", {})
            }
            
            # Add system prompt if specified
            if "system_prompt" in agent_config:
                payload["messages"].insert(0, {
                    "role": "system",
                    "content": agent_config["system_prompt"]
                })
            
            start_time = datetime.now()
            
            response = await self.client.post(
                self.base_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            
            duration = (datetime.now() - start_time).total_seconds()
            
            result = response.json()
            
            return {
                "agent": agent_name,
                "success": True,
                "output": result.get("content", ""),
                "metadata": result.get("metadata", {}),
                "duration": duration,
                "config": {k: v for k, v in agent_config.items() if k != "extra_params"}
            }
            
        except Exception as e:
            return {
                "agent": agent_name,
                "success": False,
                "error": str(e),
                "duration": 0
            }
    
    def _process_results(self, results: List[Any]) -> List[Dict[str, Any]]:
        """Process and filter results"""
        processed = []
        
        for result in results:
            if isinstance(result, Exception):
                processed.append({
                    "success": False,
                    "error": str(result)
                })
            elif isinstance(result, dict):
                processed.append(result)
        
        return processed
    
    def _aggregate_results(self, results: List[Dict[str, Any]]) -> Any:
        """Aggregate results based on strategy"""
        successful = [r for r in results if r.get("success")]
        
        if not successful:
            return None
        
        if self.config.aggregation == AggregationStrategy.FIRST:
            return successful[0]["output"]
        
        elif self.config.aggregation == AggregationStrategy.ALL:
            return {
                "outputs": [r["output"] for r in successful],
                "agents": [r["agent"] for r in successful],
                "metadata": {
                    "count": len(successful),
                    "total_duration": sum(r["duration"] for r in successful)
                }
            }
        
        elif self.config.aggregation == AggregationStrategy.BEST:
            if self.config.scorer:
                scored = [
                    (r, self.config.scorer(r["output"]))
                    for r in successful
                ]
                best = max(scored, key=lambda x: x[1])
                return {
                    "output": best[0]["output"],
                    "agent": best[0]["agent"],
                    "score": best[1]
                }
            else:
                # Default: longest output
                best = max(successful, key=lambda r: len(r["output"]))
                return best["output"]
        
        elif self.config.aggregation == AggregationStrategy.VOTE:
            # Simple voting: most common output
            outputs = [r["output"] for r in successful]
            from collections import Counter
            votes = Counter(outputs)
            winner = votes.most_common(1)[0]
            return {
                "output": winner[0],
                "votes": winner[1],
                "total": len(outputs)
            }
        
        elif self.config.aggregation == AggregationStrategy.MERGE:
            # Merge all outputs
            merged = "\n\n---\n\n".join([
                f"Agent: {r['agent']}\n{r['output']}"
                for r in successful
            ])
            return merged
        
        return successful[0]["output"]
    
    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


# Example usage patterns
async def example_multi_perspective():
    """Example: Get multiple perspectives on a topic"""
    config = ParallelConfig(
        agents=[
            {
                "name": "optimist",
                "system_prompt": "You are an optimistic analyst. Focus on benefits and opportunities.",
                "temperature": 0.8
            },
            {
                "name": "pessimist",
                "system_prompt": "You are a critical analyst. Focus on risks and challenges.",
                "temperature": 0.6
            },
            {
                "name": "realist",
                "system_prompt": "You are a balanced analyst. Consider all aspects objectively.",
                "temperature": 0.5
            }
        ],
        aggregation=AggregationStrategy.ALL
    )
    
    parallel = ParallelAgents(config)
    result = await parallel.execute("Analyze the impact of AI on employment")
    await parallel.close()
    return result


async def example_code_generation_variants():
    """Example: Generate multiple code implementations"""
    def score_code(output: str) -> float:
        """Score code based on length and complexity"""
        score = 0.0
        if "class" in output: score += 0.3
        if "def" in output: score += 0.2
        if "try" in output: score += 0.2
        if len(output) > 100: score += 0.3
        return score
    
    config = ParallelConfig(
        agents=[
            {
                "name": "simple",
                "prompt_template": "Write simple, readable code for: {input}",
                "temperature": 0.3
            },
            {
                "name": "optimized",
                "prompt_template": "Write highly optimized code for: {input}",
                "temperature": 0.4
            },
            {
                "name": "robust",
                "prompt_template": "Write production-ready code with error handling for: {input}",
                "temperature": 0.3
            }
        ],
        aggregation=AggregationStrategy.BEST,
        scorer=score_code
    )
    
    parallel = ParallelAgents(config)
    result = await parallel.execute("function to calculate fibonacci numbers")
    await parallel.close()
    return result


async def example_fast_response():
    """Example: Get fastest response from multiple models"""
    config = ParallelConfig(
        agents=[
            {"name": "fast-model", "model": "gpt-3.5-turbo", "temperature": 0.7},
            {"name": "balanced-model", "model": "gpt-4", "temperature": 0.7},
            {"name": "creative-model", "model": "claude-2", "temperature": 0.9}
        ],
        aggregation=AggregationStrategy.FIRST,
        fail_fast=True
    )
    
    parallel = ParallelAgents(config)
    result = await parallel.execute("Explain quantum computing in simple terms")
    await parallel.close()
    return result


async def example_consensus():
    """Example: Get consensus from multiple agents"""
    config = ParallelConfig(
        agents=[
            {"name": "agent1", "temperature": 0.5},
            {"name": "agent2", "temperature": 0.5},
            {"name": "agent3", "temperature": 0.5},
            {"name": "agent4", "temperature": 0.5},
            {"name": "agent5", "temperature": 0.5}
        ],
        aggregation=AggregationStrategy.VOTE
    )
    
    parallel = ParallelAgents(config)
    result = await parallel.execute("Is the sky blue? Answer with yes or no.")
    await parallel.close()
    return result


if __name__ == "__main__":
    # Test parallel execution
    asyncio.run(example_multi_perspective())
