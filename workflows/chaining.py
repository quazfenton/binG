"""
Fast-Agent Workflow: Chaining
Sequential execution of agents with output passing
"""

from typing import List, Dict, Any, Optional
import asyncio
import httpx
from datetime import datetime


class ChainConfig:
    """Configuration for agent chaining"""
    def __init__(
        self,
        agents: List[Dict[str, Any]],
        max_retries: int = 3,
        timeout: int = 30,
        pass_full_context: bool = True,
        stop_on_error: bool = False
    ):
        self.agents = agents
        self.max_retries = max_retries
        self.timeout = timeout
        self.pass_full_context = pass_full_context
        self.stop_on_error = stop_on_error


class AgentChain:
    """Chain multiple Fast-Agent calls sequentially"""
    
    def __init__(self, config: ChainConfig, base_url: str = None):
        self.config = config
        # Support subdomain configuration
        self.base_url = base_url or "https://fast-agent.yourdomain.com/api/chat"
        self.client = httpx.AsyncClient(timeout=config.timeout)
    
    async def execute(
        self,
        initial_input: str,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Execute the agent chain"""
        chain_results = []
        current_input = initial_input
        full_context = context or {}
        
        for idx, agent_config in enumerate(self.config.agents):
            step_name = agent_config.get("name", f"step_{idx}")
            print(f"[Chain] Executing step {idx + 1}/{len(self.config.agents)}: {step_name}")
            
            try:
                # Prepare agent input
                agent_input = self._prepare_input(
                    current_input,
                    full_context,
                    agent_config
                )
                
                # Execute agent
                result = await self._execute_agent(
                    agent_input,
                    agent_config
                )
                
                # Store result
                step_result = {
                    "step": idx,
                    "name": step_name,
                    "input": agent_input,
                    "output": result.get("content", ""),
                    "metadata": result.get("metadata", {}),
                    "timestamp": datetime.now().isoformat()
                }
                chain_results.append(step_result)
                
                # Update context
                if self.config.pass_full_context:
                    full_context[step_name] = result
                
                # Prepare next input
                current_input = self._extract_next_input(result, agent_config)
                
            except Exception as e:
                error_result = {
                    "step": idx,
                    "name": step_name,
                    "error": str(e),
                    "timestamp": datetime.now().isoformat()
                }
                chain_results.append(error_result)
                
                if self.config.stop_on_error:
                    print(f"[Chain] Stopping due to error at step {idx}")
                    break
                else:
                    print(f"[Chain] Error at step {idx}, continuing...")
                    current_input = f"Previous step failed: {str(e)}"
        
        return {
            "success": not any("error" in r for r in chain_results),
            "steps": chain_results,
            "final_output": chain_results[-1].get("output", "") if chain_results else "",
            "context": full_context
        }
    
    def _prepare_input(
        self,
        current_input: str,
        context: Dict[str, Any],
        agent_config: Dict[str, Any]
    ) -> str:
        """Prepare input for the next agent"""
        template = agent_config.get("input_template")
        
        if template:
            # Use template with context substitution
            return template.format(
                input=current_input,
                **context
            )
        else:
            # Use raw input
            return current_input
    
    async def _execute_agent(
        self,
        input_text: str,
        agent_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a single agent call"""
        payload = {
            "messages": [
                {"role": "user", "content": input_text}
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
        
        # Retry logic
        for attempt in range(self.config.max_retries):
            try:
                response = await self.client.post(
                    self.base_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                return response.json()
                
            except Exception as e:
                if attempt == self.config.max_retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
    
    def _extract_next_input(
        self,
        result: Dict[str, Any],
        agent_config: Dict[str, Any]
    ) -> str:
        """Extract input for next agent from result"""
        output_extractor = agent_config.get("output_extractor")
        
        if output_extractor:
            # Custom extraction logic
            if callable(output_extractor):
                return output_extractor(result)
            elif isinstance(output_extractor, str):
                # JSONPath or simple key extraction
                return result.get(output_extractor, result.get("content", ""))
        
        # Default: use content
        return result.get("content", str(result))
    
    async def close(self):
        """Close the HTTP client"""
        await self.client.aclose()


# Example usage patterns
async def example_code_review_chain():
    """Example: Code review chain"""
    config = ChainConfig(
        agents=[
            {
                "name": "analyzer",
                "system_prompt": "You are a code analyzer. Identify issues and improvements.",
                "model": "gpt-4",
                "temperature": 0.3
            },
            {
                "name": "suggester",
                "system_prompt": "You are a code improvement suggester. Provide specific fixes.",
                "input_template": "Based on these issues: {input}\n\nProvide specific code improvements.",
                "model": "gpt-4",
                "temperature": 0.5
            },
            {
                "name": "implementer",
                "system_prompt": "You are a code implementer. Write the improved code.",
                "input_template": "Implement these improvements: {input}",
                "model": "gpt-4",
                "temperature": 0.3
            }
        ],
        pass_full_context=True
    )
    
    chain = AgentChain(config)
    
    code = """
    def calculate(x, y):
        return x + y
    """
    
    result = await chain.execute(
        f"Review this code:\n\n{code}",
        context={"language": "python"}
    )
    
    await chain.close()
    return result


async def example_research_chain():
    """Example: Research and summarization chain"""
    config = ChainConfig(
        agents=[
            {
                "name": "researcher",
                "system_prompt": "Research the topic and gather key information.",
                "model": "gpt-4"
            },
            {
                "name": "organizer",
                "system_prompt": "Organize the research into structured sections.",
                "input_template": "Organize this research: {input}"
            },
            {
                "name": "writer",
                "system_prompt": "Write a comprehensive article from the organized research.",
                "input_template": "Write an article using this structure: {input}"
            }
        ]
    )
    
    chain = AgentChain(config)
    result = await chain.execute("Research AI agents")
    await chain.close()
    return result


async def example_conditional_chain():
    """Example: Conditional chain with branching logic"""
    config = ChainConfig(
        agents=[
            {
                "name": "classifier",
                "system_prompt": "Classify the input type: code, text, or data."
            },
            {
                "name": "processor",
                "system_prompt": "Process based on classification.",
                "input_template": "Type: {classifier[type]}\nInput: {input}"
            }
        ]
    )
    
    chain = AgentChain(config)
    result = await chain.execute("def hello(): print('world')")
    await chain.close()
    return result


if __name__ == "__main__":
    # Test the chaining
    asyncio.run(example_code_review_chain())
