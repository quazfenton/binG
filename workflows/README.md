# Fast-Agent Workflows

Advanced workflow patterns for orchestrating Fast-Agent calls.

## Overview

These workflows enable complex AI interactions:
- **Chaining**: Sequential execution with output passing
- **Parallel**: Concurrent execution with aggregation
- **Router**: Intelligent routing to specialized agents
- **Evaluator**: Quality assessment and scoring

## Installation

```bash
pip install httpx asyncio
```

## Quick Start

### 1. Chaining Example

```python
from workflows.chaining import AgentChain, ChainConfig

config = ChainConfig(
    agents=[
        {
            "name": "analyzer",
            "system_prompt": "You are a code analyzer.",
            "model": "gpt-4"
        },
        {
            "name": "improver",
            "system_prompt": "You improve code based on analysis.",
            "input_template": "Improve based on: {input}"
        }
    ]
)

chain = AgentChain(
    config,
    base_url="https://fast-agent.yourdomain.com/api/chat"
)

result = await chain.execute("Review this code: def hello(): print('hi')")
await chain.close()
```

### 2. Parallel Example

```python
from workflows.parallel import ParallelAgents, ParallelConfig, AggregationStrategy

config = ParallelConfig(
    agents=[
        {"name": "creative", "temperature": 0.9},
        {"name": "precise", "temperature": 0.3},
        {"name": "balanced", "temperature": 0.7}
    ],
    aggregation=AggregationStrategy.BEST
)

parallel = ParallelAgents(
    config,
    base_url="https://fast-agent.yourdomain.com/api/chat"
)

result = await parallel.execute("Write a hello world function")
await parallel.close()
```

### 3. Router Example

```python
from workflows.router import AgentRouter, RouterConfig, RoutingStrategy

config = RouterConfig(
    agents=[
        {
            "name": "python-expert",
            "routing_rules": [
                {"keywords": ["python", "py"]},
                {"pattern": r"def |class "}
            ]
        },
        {
            "name": "javascript-expert",
            "routing_rules": [
                {"keywords": ["javascript", "js", "node"]}
            ]
        }
    ],
    strategy=RoutingStrategy.RULE_BASED
)

router = AgentRouter(
    config,
    base_url="https://fast-agent.yourdomain.com/api/chat"
)

result = await router.route("Write a Python function")
await router.close()
```

### 4. Evaluator Example

```python
from workflows.evaluator import AgentEvaluator, EvaluatorConfig, EvaluationMetric

config = EvaluatorConfig(
    metrics=[
        EvaluationMetric.ACCURACY,
        EvaluationMetric.COMPLETENESS,
        EvaluationMetric.CLARITY
    ],
    threshold=0.75,
    use_llm_judge=True
)

evaluator = AgentEvaluator(
    config,
    base_url="https://fast-agent.yourdomain.com/api/chat"
)

result = await evaluator.evaluate(
    output="Your agent output here",
    expected="Expected output (optional)"
)
await evaluator.close()
```

## Configuration

### Base URL Configuration

All workflows support configuring the Fast-Agent endpoint:

```python
# Localhost (development)
base_url = "http://localhost:8080/api/chat"

# Subdomain (production)
base_url = "https://fast-agent.yourdomain.com/api/chat"

# Custom port
base_url = "https://agent.yourdomain.com:8443/api/chat"
```

### Environment Variables

Set in `.env`:

```env
# Fast-Agent endpoint
FAST_AGENT_ENDPOINT=https://fast-agent.yourdomain.com/api/chat

# Enable workflows
FAST_AGENT_ENABLE_WORKFLOWS=true

# Workflow timeout
FAST_AGENT_WORKFLOW_TIMEOUT=60000
```

## Workflow Patterns

### Chaining (Sequential)

**Use Cases:**
- Multi-step code generation
- Research → Analysis → Summary
- Review → Improve → Test

**Features:**
- Pass output to next agent
- Full context preservation
- Error handling with stop/continue
- Custom input templates

### Parallel (Concurrent)

**Use Cases:**
- Multiple perspectives
- A/B testing prompts
- Fast response (first completes wins)
- Consensus voting

**Aggregation Strategies:**
- `FIRST`: Return first completed
- `ALL`: Return all results
- `BEST`: Select highest scored
- `VOTE`: Majority consensus
- `MERGE`: Combine all outputs

### Router (Intelligent)

**Use Cases:**
- Task-specific agents
- Language-specific routing
- Complexity-based routing
- Load balancing

**Routing Strategies:**
- `RULE_BASED`: Pattern/keyword matching
- `SEMANTIC`: Embedding similarity
- `LOAD_BALANCED`: Distribute load
- `ADAPTIVE`: Learn from performance

### Evaluator (Quality)

**Use Cases:**
- Quality gates
- A/B test comparison
- Performance monitoring
- Output validation

**Metrics:**
- Accuracy
- Completeness
- Relevance
- Clarity
- Correctness
- Safety
- Custom metrics

## Integration with Next.js

### API Route Example

```typescript
// app/api/workflow/chain/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { input, workflow } = await req.json();
  
  // Use subprocess to run Python workflow
  const { spawn } = require('child_process');
  
  const python = spawn('python3', [
    'workflows/run_chain.py',
    '--input', input,
    '--config', workflow
  ]);
  
  let output = '';
  python.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  
  return new Promise((resolve) => {
    python.on('close', () => {
      resolve(NextResponse.json({ result: output }));
    });
  });
}
```

### Direct Integration

```typescript
// Use Cloudflare Worker or external service to run Python workflows
const response = await fetch('https://workflow-runner.yourdomain.com/chain', {
  method: 'POST',
  body: JSON.stringify({
    workflow: 'chaining',
    input: 'Your input',
    config: {...}
  })
});
```

## Advanced Examples

### Complex Chain with Conditional Logic

```python
config = ChainConfig(
    agents=[
        {
            "name": "classifier",
            "system_prompt": "Classify the request type."
        },
        {
            "name": "processor",
            "input_template": "Process as {classifier[type]}: {input}"
        },
        {
            "name": "validator",
            "system_prompt": "Validate the output."
        }
    ],
    pass_full_context=True,
    stop_on_error=False
)
```

### Parallel with Custom Scoring

```python
def score_output(output: str) -> float:
    score = 0.0
    if len(output) > 100: score += 0.3
    if "function" in output: score += 0.3
    if "test" in output: score += 0.4
    return score

config = ParallelConfig(
    agents=[...],
    aggregation=AggregationStrategy.BEST,
    scorer=score_output
)
```

### Adaptive Router with Stats

```python
router = AgentRouter(config, base_url=...)

# Make requests
for i in range(10):
    await router.route(f"Request {i}")

# Check performance
stats = router.get_stats()
print(f"Agent 1 success rate: {stats['agent-1']['success_rate']}")
```

## Best Practices

### 1. Timeout Management

```python
# Set appropriate timeouts
config = ChainConfig(
    agents=[...],
    timeout=30,  # Per-agent timeout
    max_retries=3
)
```

### 2. Error Handling

```python
# Enable fallback
config = RouterConfig(
    agents=[...],
    enable_fallback=True,
    default_agent="general-purpose"
)
```

### 3. Context Preservation

```python
# Pass full context for complex chains
config = ChainConfig(
    agents=[...],
    pass_full_context=True  # All previous outputs available
)
```

### 4. Resource Management

```python
# Always close clients
try:
    result = await workflow.execute(input)
finally:
    await workflow.close()
```

### 5. Subdomain Configuration

```python
# Use environment variable for flexibility
import os

base_url = os.getenv(
    'FAST_AGENT_ENDPOINT',
    'http://localhost:8080/api/chat'
)

workflow = MyWorkflow(config, base_url=base_url)
```

## Performance Tips

1. **Parallel over Sequential**: Use parallel when tasks are independent
2. **Adaptive Routing**: Enable for repeated similar tasks
3. **LLM Judge**: Disable for faster heuristic evaluation
4. **Concurrent Limits**: Set `max_concurrent` to avoid overload
5. **Caching**: Cache evaluation results for repeated inputs

## Troubleshooting

### Connection Issues

```python
# Check Fast-Agent is accessible
import httpx

async def test_connection():
    client = httpx.AsyncClient()
    try:
        response = await client.get("https://fast-agent.yourdomain.com/health")
        print(f"Status: {response.status_code}")
    finally:
        await client.aclose()
```

### Timeout Errors

```python
# Increase timeout for complex tasks
config = ChainConfig(
    agents=[...],
    timeout=60  # 60 seconds
)
```

### CORS Issues

If accessing from browser, ensure Fast-Agent has CORS configured:

```
Access-Control-Allow-Origin: https://yourdomain.com
```

## Next Steps

1. **Test workflows locally** with `http://localhost:8080`
2. **Deploy Fast-Agent** to subdomain
3. **Update configuration** to use subdomain URL
4. **Monitor performance** with router stats
5. **Optimize chains** based on evaluation results

## Documentation

- **Chaining**: Sequential workflows with context passing
- **Parallel**: Concurrent execution with aggregation
- **Router**: Intelligent request routing
- **Evaluator**: Quality assessment and scoring

## Support

For issues or questions:
1. Check Fast-Agent logs
2. Verify subdomain DNS configuration
3. Test with curl: `curl -X POST https://fast-agent.yourdomain.com/api/chat`
4. Review workflow logs for errors
