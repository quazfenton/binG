# Agent Practice — Training-Free GRPO

This module provides **experience-based self-learning** for agents, adapted from
[Youtu-Agent](https://github.com/TencentCloudADP/youtu-agent)'s Training-Free Group Relative Policy Optimization (GRPO).

## What It Does

Instead of fine-tuning LLM weights, this module **extracts experiences from practice trajectories** and injects them into the agent's system prompt. The agent accumulates experiences over practice sessions, progressively improving its performance through in-context learning.

## Flow

```
1. Load dataset (question-answer pairs)
   ↓
2. Rollout: run agent on each question multiple times (GRPO groups)
   ↓
3. Judge: score each rollout against ground truth (verifier)
   ↓
4. Summarize: analyze successful vs failed trajectories
   ↓
5. Extract experiences: identify generalizable guidelines
   ↓
6. Critique & refine: compare against existing experiences
   ↓
7. Save enhanced agent config with experiences embedded in instructions
   ↓
8. Evaluate enhanced agent on held-out test set
```

## Directory Structure

```
packages/shared/agent/practice/
├── __init__.py                 # Module exports
├── training_free_grpo.py       # Main orchestrator
├── rollout_manager.py          # Rollout execution and batch processing
├── experience_updater.py       # Experience processing and integration
├── data_manager.py             # Dataset management
├── config.py                   # Configuration models (Pydantic/dataclass)
├── db.py                       # SQLModel database models
├── utils.py                    # Utilities (logging, LLM client, cache)
├── prompts/
│   └── experience.yaml         # Prompts for experience extraction
└── verify/
    ├── __init__.py
    ├── math.py                 # Math problem verifier (uses math_verify)
    └── webwalker.py            # Web search verifier (uses LLM judge)
```

## Quick Start

### 1. Set up environment

```bash
# Required: LLM configuration
export UTU_LLM_TYPE=chat.completions
export UTU_LLM_MODEL=gpt-4o
export UTU_LLM_BASE_URL=https://api.openai.com/v1
export UTU_LLM_API_KEY=your-key

# Optional: database URL (defaults to sqlite:///practice.db)
export PRACTICE_DB_URL=sqlite:///practice.db
```

### 2. Load data

You need question-answer pairs in the database. Each sample needs:
- `dataset`: dataset name
- `source`: must be `"training_free_grpo"`
- `question`: the question/prompt
- `answer`: the expected answer (or None if using LLM judge)

```python
from sqlmodel import Session, create_engine
from packages.shared.agent.practice.db import DatasetSample

engine = create_engine("sqlite:///practice.db")
with Session(engine) as session:
    sample = DatasetSample(
        dataset="MyDataset",
        source="training_free_grpo",
        question="What is 2 + 2?",
        answer="4",
        index=0,
    )
    session.add(sample)
    session.commit()
```

### 3. Run practice

```python
import asyncio
from packages.shared.agent.practice import TrainingFreeGRPO, parse_training_free_grpo_config

config = parse_training_free_grpo_config()
# Or create config manually:
# config = TrainingFreeGRPOConfig(exp_id="my-practice", ...)

grpo = TrainingFreeGRPO(config)
result_path = asyncio.run(grpo.run())
print(f"Enhanced agent config saved to: {result_path}")
```

### 4. CLI

```bash
python scripts/practice/run_training_free_GRPO.py --config_name my_practice
```

## Configuration

Configs live in `configs/practice/`. Example:

```yaml
# configs/practice/my_practice.yaml
# @package _global_
exp_id: "my_practice"

evaluation:
  exp_id: "my_eval"
  agent:
    name: "practice-agent"
    instructions: "You are a helpful assistant."
    model:
      model_provider:
        type: chat.completions
        model: gpt-4o
      model_settings:
        temperature: 0.7
  data:
    dataset: "MyDataset"
    type: "single"
  concurrency: 16
  pass_k: 3

practice:
  epochs: 5
  batch_size: 32
  grpo_n: 3            # rollouts per GRPO group
  rollout_temperature: 0.7
  task_timeout: 3600
  do_eval: false
  agent_objective: |
    input: A math question
    output: A step-by-step reasoning process
  learning_objective: |
    Help the agent improve by extracting concise guidelines.
  num_experiences_per_query: 1

data:
  practice_dataset_name: "MyDataset"
```

## Verification Functions

Verifiers live in `practice/verify/` and follow this interface:

```python
from ..db import EvaluationSample

def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    """
    Returns:
        dict: {"reward": 0.0-1.0, "reasoning": "optional details"}
    """
    if sample.correct_answer.lower() == sample.response.lower():
        return {"reward": 1.0, "reasoning": None}
    return {"reward": 0.0, "reasoning": None}
```

Configure which verifier to use in your eval config:
```yaml
evaluation:
  verify_filename: "math.py"
  verify_func_name: "verify_func"
```

## Custom Runner Integration

The default `rollout_one` in `RolloutManager` is a placeholder. To integrate with
your actual agent system, subclass and override:

```python
from packages.shared.agent.practice import RolloutManager
from packages.shared.agent.practice.db import EvaluationSample

class MyRolloutManager(RolloutManager):
    async def rollout_one(self, sample: EvaluationSample) -> EvaluationSample:
        # Call your agent with sample.raw_question
        response = await my_agent.run(sample.raw_question)
        sample.response = response
        sample.stage = "rollout"
        self.dataset.save(sample)
        return sample
```

## Dependencies

| Package | Required | Purpose |
|---------|----------|---------|
| `sqlmodel` | Yes | Database storage |
| `openai` | Yes | LLM API client |
| `agents` (openai-agents) | Yes | Tracing spans |
| `tqdm` | Yes | Progress bars |
| `pyyaml` | Yes | Config/prompt loading |
| `math_verify` | Optional | Math problem verification |

## Credits

Adapted from [Youtu-Agent](https://github.com/TencentCloudADP/youtu-agent) by Tencent Youtu Lab.
Paper: [Training-Free Group Relative Policy Optimization](https://arxiv.org/abs/2510.08191)
