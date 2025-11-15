"""
Fast-Agent Workflow: Router
Intelligent routing between different agents based on request analysis
"""

from typing import List, Dict, Any, Optional, Callable
import asyncio
import httpx
import re
from datetime import datetime
from enum import Enum


class RoutingStrategy(Enum):
    """Strategy for routing requests"""
    RULE_BASED = "rule_based"  # Route based on rules
    SEMANTIC = "semantic"  # Route based on semantic analysis
    LOAD_BALANCED = "load_balanced"  # Balance load across agents
    ADAPTIVE = "adaptive"  # Learn from past performance


class RouterConfig:
    """Configuration for agent router"""
    def __init__(
        self,
        agents: List[Dict[str, Any]],
        strategy: RoutingStrategy = RoutingStrategy.RULE_BASED,
        default_agent: Optional[str] = None,
        timeout: int = 30,
        enable_fallback: bool = True
    ):
        self.agents = agents
        self.strategy = strategy
        self.default_agent = default_agent
        self.timeout = timeout
        self.enable_fallback = enable_fallback


class AgentRouter:
    """Route requests to appropriate agents"""
    
    def __init__(self, config: RouterConfig, base_url: str = None):
        self.config = config
        self.base_url = base_url or "https://fast-agent.yourdomain.com/api/chat"
        self.client = httpx.AsyncClient(timeout=config.timeout)
        self.performance_stats = {}  # Track agent performance
    
    async def route(
        self,
        input_text: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Route request to appropriate agent"""
        
        # Select agent
        selected_agent = await self._select_agent(input_text, context or {})
        
        if not selected_agent:
            return {
                "success": False,
                "error": "No suitable agent found",
                "input": input_text
            }
        
        # Execute primary agent
        try:
            result = await self._execute_agent(
                input_text,
                selected_agent,
                context or {}
            )
            
            # Update performance stats
            self._update_stats(selected_agent["name"], True, result.get("duration", 0))
            
            return {
                "success": True,
                "agent": selected_agent["name"],
                "output": result.get("output", ""),
                "metadata": result.get("metadata", {}),
                "routing_strategy": self.config.strategy.value
            }
            
        except Exception as e:
            # Update stats
            self._update_stats(selected_agent["name"], False, 0)
            
            # Try fallback if enabled
            if self.config.enable_fallback:
                fallback_result = await self._try_fallback(input_text, selected_agent, context or {})
                if fallback_result:
                    return fallback_result
            
            return {
                "success": False,
                "agent": selected_agent["name"],
                "error": str(e),
                "input": input_text
            }
    
    async def _select_agent(
        self,
        input_text: str,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Select the most appropriate agent"""
        
        if self.config.strategy == RoutingStrategy.RULE_BASED:
            return self._rule_based_selection(input_text, context)
        
        elif self.config.strategy == RoutingStrategy.SEMANTIC:
            return await self._semantic_selection(input_text, context)
        
        elif self.config.strategy == RoutingStrategy.LOAD_BALANCED:
            return self._load_balanced_selection()
        
        elif self.config.strategy == RoutingStrategy.ADAPTIVE:
            return self._adaptive_selection(input_text, context)
        
        return self._get_default_agent()
    
    def _rule_based_selection(
        self,
        input_text: str,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Select agent based on pattern matching rules"""
        
        for agent in self.config.agents:
            rules = agent.get("routing_rules", [])
            
            for rule in rules:
                # Pattern matching
                if "pattern" in rule:
                    if re.search(rule["pattern"], input_text, re.IGNORECASE):
                        return agent
                
                # Keyword matching
                if "keywords" in rule:
                    if any(kw.lower() in input_text.lower() for kw in rule["keywords"]):
                        return agent
                
                # Context matching
                if "context_key" in rule:
                    if context.get(rule["context_key"]) == rule.get("context_value"):
                        return agent
                
                # Length-based routing
                if "min_length" in rule and "max_length" in rule:
                    length = len(input_text)
                    if rule["min_length"] <= length <= rule["max_length"]:
                        return agent
        
        return self._get_default_agent()
    
    async def _semantic_selection(
        self,
        input_text: str,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Select agent based on semantic similarity (placeholder for embedding-based routing)"""
        # In production, use embeddings to match input to agent capabilities
        # For now, fall back to rule-based
        return self._rule_based_selection(input_text, context)
    
    def _load_balanced_selection(self) -> Optional[Dict[str, Any]]:
        """Select agent with lowest current load"""
        # Simple load balancing: select agent with fewest recent requests
        agent_loads = {
            agent["name"]: self.performance_stats.get(agent["name"], {}).get("total_requests", 0)
            for agent in self.config.agents
        }
        
        if not agent_loads:
            return self._get_default_agent()
        
        least_loaded = min(agent_loads, key=agent_loads.get)
        return next(a for a in self.config.agents if a["name"] == least_loaded)
    
    def _adaptive_selection(
        self,
        input_text: str,
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Select agent based on past performance"""
        # Start with rule-based selection
        candidates = [
            agent for agent in self.config.agents
            if self._matches_rules(agent, input_text, context)
        ]
        
        if not candidates:
            candidates = self.config.agents
        
        # Select best performing agent from candidates
        best_agent = None
        best_score = -1
        
        for agent in candidates:
            stats = self.performance_stats.get(agent["name"], {})
            success_rate = stats.get("success_rate", 0.5)
            avg_duration = stats.get("avg_duration", 10)
            
            # Score: balance success rate and speed
            score = success_rate * 0.7 + (1 / (avg_duration + 1)) * 0.3
            
            if score > best_score:
                best_score = score
                best_agent = agent
        
        return best_agent or self._get_default_agent()
    
    def _matches_rules(
        self,
        agent: Dict[str, Any],
        input_text: str,
        context: Dict[str, Any]
    ) -> bool:
        """Check if agent matches routing rules"""
        rules = agent.get("routing_rules", [])
        if not rules:
            return True
        
        for rule in rules:
            if "pattern" in rule and re.search(rule["pattern"], input_text, re.IGNORECASE):
                return True
            if "keywords" in rule and any(kw.lower() in input_text.lower() for kw in rule["keywords"]):
                return True
        
        return False
    
    def _get_default_agent(self) -> Optional[Dict[str, Any]]:
        """Get default agent"""
        if self.config.default_agent:
            return next(
                (a for a in self.config.agents if a["name"] == self.config.default_agent),
                None
            )
        return self.config.agents[0] if self.config.agents else None
    
    async def _try_fallback(
        self,
        input_text: str,
        failed_agent: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Try fallback agents if primary fails"""
        fallback_agents = [
            agent for agent in self.config.agents
            if agent["name"] != failed_agent["name"]
        ]
        
        for agent in fallback_agents:
            try:
                result = await self._execute_agent(input_text, agent, context)
                self._update_stats(agent["name"], True, result.get("duration", 0))
                
                return {
                    "success": True,
                    "agent": agent["name"],
                    "output": result.get("output", ""),
                    "fallback": True,
                    "failed_agent": failed_agent["name"]
                }
            except Exception:
                continue
        
        return None
    
    async def _execute_agent(
        self,
        input_text: str,
        agent_config: Dict[str, Any],
        context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute agent call"""
        payload = {
            "messages": [
                {"role": "user", "content": input_text}
            ],
            "model": agent_config.get("model", "default"),
            "temperature": agent_config.get("temperature", 0.7),
            "max_tokens": agent_config.get("max_tokens", 2000),
            **agent_config.get("extra_params", {})
        }
        
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
            "output": result.get("content", ""),
            "metadata": result.get("metadata", {}),
            "duration": duration
        }
    
    def _update_stats(self, agent_name: str, success: bool, duration: float):
        """Update performance statistics"""
        if agent_name not in self.performance_stats:
            self.performance_stats[agent_name] = {
                "total_requests": 0,
                "successful_requests": 0,
                "failed_requests": 0,
                "total_duration": 0,
                "success_rate": 0.0,
                "avg_duration": 0.0
            }
        
        stats = self.performance_stats[agent_name]
        stats["total_requests"] += 1
        
        if success:
            stats["successful_requests"] += 1
            stats["total_duration"] += duration
        else:
            stats["failed_requests"] += 1
        
        stats["success_rate"] = stats["successful_requests"] / stats["total_requests"]
        if stats["successful_requests"] > 0:
            stats["avg_duration"] = stats["total_duration"] / stats["successful_requests"]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get performance statistics"""
        return self.performance_stats
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


# Example usage patterns
async def example_code_task_router():
    """Example: Route code tasks to specialized agents"""
    config = RouterConfig(
        agents=[
            {
                "name": "python-specialist",
                "system_prompt": "You are a Python expert.",
                "routing_rules": [
                    {"keywords": ["python", "py", "django", "flask"]},
                    {"pattern": r"def |class |import "}
                ],
                "model": "gpt-4"
            },
            {
                "name": "javascript-specialist",
                "system_prompt": "You are a JavaScript expert.",
                "routing_rules": [
                    {"keywords": ["javascript", "js", "react", "node", "typescript"]},
                    {"pattern": r"function |const |let |var |=>"}
                ],
                "model": "gpt-4"
            },
            {
                "name": "general-coder",
                "system_prompt": "You are a general programming expert.",
                "model": "gpt-3.5-turbo"
            }
        ],
        strategy=RoutingStrategy.RULE_BASED,
        default_agent="general-coder"
    )
    
    router = AgentRouter(config)
    result = await router.route("Write a Python function to parse JSON")
    await router.close()
    return result


async def example_complexity_router():
    """Example: Route by request complexity"""
    config = RouterConfig(
        agents=[
            {
                "name": "simple-agent",
                "routing_rules": [
                    {"min_length": 0, "max_length": 100}
                ],
                "model": "gpt-3.5-turbo",
                "temperature": 0.5
            },
            {
                "name": "complex-agent",
                "routing_rules": [
                    {"min_length": 100, "max_length": 1000}
                ],
                "model": "gpt-4",
                "temperature": 0.7
            }
        ],
        strategy=RoutingStrategy.RULE_BASED
    )
    
    router = AgentRouter(config)
    result = await router.route("Explain quantum computing")
    await router.close()
    return result


async def example_adaptive_router():
    """Example: Adaptive routing based on performance"""
    config = RouterConfig(
        agents=[
            {"name": "agent-1", "model": "gpt-3.5-turbo"},
            {"name": "agent-2", "model": "gpt-4"},
            {"name": "agent-3", "model": "claude-2"}
        ],
        strategy=RoutingStrategy.ADAPTIVE,
        enable_fallback=True
    )
    
    router = AgentRouter(config)
    
    # Simulate multiple requests
    for i in range(5):
        result = await router.route(f"Request {i}")
        print(f"Request {i} routed to: {result.get('agent')}")
    
    # Check stats
    stats = router.get_stats()
    print("Performance stats:", stats)
    
    await router.close()
    return stats


if __name__ == "__main__":
    asyncio.run(example_code_task_router())
