"""
Practice configuration models.

Adapted from Youtu-Agent's utu.config module.
Uses Pydantic for validation with hierarchical YAML loading.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional


@dataclass
class ModelProviderConfig:
    """LLM provider configuration."""
    type: str = "chat.completions"
    model: str = "gpt-4o"
    base_url: Optional[str] = None
    api_key: Optional[str] = None

    def model_dump(self, exclude_none: bool = True) -> dict:
        d = {}
        for k, v in self.__dict__.items():
            if exclude_none and v is None:
                continue
            d[k] = v
        return d


@dataclass
class ModelSettings:
    """LLM model settings."""
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None

    def model_dump(self, exclude_none: bool = True) -> dict:
        d = {}
        for k, v in self.__dict__.items():
            if exclude_none and v is None:
                continue
            d[k] = v
        return d


@dataclass
class AgentModelConfig:
    """Model sub-config within agent config."""
    model_provider: ModelProviderConfig = field(default_factory=ModelProviderConfig)
    model_settings: ModelSettings = field(default_factory=ModelSettings)

    def model_dump(self, exclude_none: bool = True) -> dict:
        return {
            "model_provider": self.model_provider.model_dump(exclude_none=exclude_none),
            "model_settings": self.model_settings.model_dump(exclude_none=exclude_none),
        }


@dataclass
class AgentConfig:
    """Agent configuration."""
    name: str = "practice-agent"
    instructions: str = "You are a helpful assistant."
    model: AgentModelConfig = field(default_factory=AgentModelConfig)
    toolkits: dict[str, Any] = field(default_factory=dict)
    type: str = "agent"

    def model_dump(self, exclude_none: bool = True) -> dict:
        return {
            "type": self.type,
            "model": self.model.model_dump(exclude_none=exclude_none),
            "agent": {
                "name": self.name,
                "instructions": self.instructions,
            },
            "toolkits": self.toolkits,
        }


@dataclass
class DataConfig:
    """Data configuration for evaluation/practice."""
    dataset: Optional[str] = None
    type: str = "single"

    def model_dump(self, exclude_none: bool = True) -> dict:
        d = {}
        for k, v in self.__dict__.items():
            if exclude_none and v is None:
                continue
            d[k] = v
        return d


@dataclass
class EvalConfig:
    """Evaluation configuration."""
    exp_id: str = "eval"
    agent: AgentConfig = field(default_factory=AgentConfig)
    data: DataConfig = field(default_factory=DataConfig)
    concurrency: int = 64
    pass_k: int = 3
    verify_filename: Optional[str] = None
    verify_func_name: Optional[str] = None
    judge_model: Optional[dict] = None

    def model_copy(self) -> "EvalConfig":
        import copy
        return copy.deepcopy(self)


@dataclass
class PracticeConfig:
    """Practice-specific arguments."""
    epochs: int = 5
    batch_size: int = 32
    grpo_n: int = 3
    rollout_concurrency: int = 64
    rollout_temperature: float = 0.7
    task_timeout: int = 3600
    do_eval: bool = False
    eval_strategy: str = "epoch"
    eval_steps: int = 10
    restart_step: Optional[int] = None
    agent_objective: str = "input: A task\noutput: A solution"
    learning_objective: str = "Help the agent improve by extracting guidelines."
    num_experiences_per_query: int = 1
    shuffle_data: bool = True
    rollout_data_truncate: Optional[int] = None
    eval_data_truncate: Optional[int] = None
    given_ground_truth: bool = True

    def model_copy(self) -> "PracticeConfig":
        import copy
        return copy.deepcopy(self)


@dataclass
class DataArguments:
    """Data processing parameters."""
    practice_dataset_name: str = "PracticeDataset"
    eval_dataset_name: Optional[str] = None


@dataclass
class TrainingFreeGRPOConfig:
    """Unified configuration for Training-Free GRPO."""
    exp_id: str = "training-free-grpo"
    evaluation: EvalConfig = field(default_factory=EvalConfig)
    practice: PracticeConfig = field(default_factory=PracticeConfig)
    data: DataArguments = field(default_factory=DataArguments)

    def model_copy(self) -> "TrainingFreeGRPOConfig":
        import copy
        return copy.deepcopy(self)


class ConfigLoader:
    """Minimal config loader for YAML files."""

    @staticmethod
    def load_eval_config(name: str) -> EvalConfig:
        """Load evaluation config from YAML file."""
        import yaml
        import os

        # Try multiple config paths
        paths_to_try = [
            os.path.join(os.getcwd(), "configs", "eval", f"{name}.yaml"),
            os.path.join(os.getcwd(), "configs", "practice", f"{name}.yaml"),
        ]

        config_path = None
        for p in paths_to_try:
            if os.path.exists(p):
                config_path = p
                break

        if config_path is None:
            raise FileNotFoundError(f"Config file not found for: {name}. Tried: {paths_to_try}")

        with open(config_path, "r") as f:
            raw = yaml.safe_load(f)

        return _dict_to_eval_config(raw)


def _dict_to_eval_config(d: dict) -> EvalConfig:
    """Convert a dict to EvalConfig."""
    agent_dict = d.get("agent", {})
    if isinstance(agent_dict, dict):
        agent_model = agent_dict.get("model", {})
        model_provider = ModelProviderConfig(
            type=agent_model.get("model_provider", {}).get("type", "chat.completions"),
            model=agent_model.get("model_provider", {}).get("model", "gpt-4o"),
            base_url=agent_model.get("model_provider", {}).get("base_url"),
            api_key=agent_model.get("model_provider", {}).get("api_key"),
        )
        model_settings = ModelSettings(
            temperature=agent_model.get("model_settings", {}).get("temperature", 0.7),
        )
        agent = AgentConfig(
            name=agent_dict.get("name", "practice-agent"),
            instructions=agent_dict.get("instructions", "You are a helpful assistant."),
            model=AgentModelConfig(model_provider=model_provider, model_settings=model_settings),
        )
    else:
        agent = AgentConfig()

    data_dict = d.get("data", {})
    data = DataConfig(
        dataset=data_dict.get("dataset"),
        type=data_dict.get("type", "single"),
    )

    return EvalConfig(
        exp_id=d.get("exp_id", "eval"),
        agent=agent,
        data=data,
        concurrency=d.get("concurrency", 64),
        pass_k=d.get("pass_k", 3),
        verify_filename=d.get("verify_filename"),
        verify_func_name=d.get("verify_func_name"),
    )
