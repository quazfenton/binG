"""
Utility adapters for the practice module.

Adapted from Youtu-Agent's utu.utils module.
Provides logging, file operations, LLM client, and experience cache.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Optional

# ─── Directory root ───────────────────────────────────────────────────────────

DIR_ROOT = pathlib.Path(__file__).parent.parent.parent.parent  # repo root


# ─── Logger ───────────────────────────────────────────────────────────────────

def get_logger(name: str, level: str = "INFO") -> logging.Logger:
    """Get a logger instance with the given name."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        formatter = logging.Formatter(
            "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    return logger


# ─── File utilities ────────────────────────────────────────────────────────────

class FileUtils:
    """File utility methods, adapted from Youtu-Agent."""

    @staticmethod
    def load_prompts(prompt_file: str) -> dict:
        """Load prompt templates from YAML file."""
        import yaml

        prompt_path = DIR_ROOT / "configs" / "prompts" / "practice" / prompt_file
        if not prompt_path.exists():
            # Fallback: try relative to practice module
            prompt_path = pathlib.Path(__file__).parent / "prompts" / prompt_file

        if not prompt_path.exists():
            return {}

        with open(prompt_path, "r") as f:
            return yaml.safe_load(f) or {}


# ─── Simplified Async OpenAI client ──────────────────────────────────────────

class SimplifiedAsyncOpenAI:
    """Simplified async LLM client compatible with OpenAI API format."""

    def __init__(
        self,
        type: str = "chat.completions",
        model: str = "gpt-4o",
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        **kwargs: Any,
    ):
        self.type = type
        self.model = model
        self.base_url = base_url
        self.api_key = api_key
        self.extra_kwargs = kwargs

        # Create the underlying client lazily
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                from openai import AsyncOpenAI
                self._client = AsyncOpenAI(
                    api_key=self.api_key or os.environ.get("OPENAI_API_KEY", ""),
                    base_url=self.base_url,
                    **self.extra_kwargs,
                )
            except ImportError:
                raise ImportError(
                    "openai package is required for SimplifiedAsyncOpenAI. "
                    "Install with: pip install openai"
                )
        return self._client

    async def chat_completion(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        **kwargs: Any,
    ) -> str:
        """Get a chat completion."""
        client = self._get_client()
        response = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            **kwargs,
        )
        return response.choices[0].message.content or ""


# ─── SQLModel utilities ───────────────────────────────────────────────────────

class SQLModelUtils:
    """Utility for SQLModel session management."""

    @staticmethod
    @contextmanager
    def create_session():
        """Create a database session context manager."""
        from sqlmodel import Session, create_engine

        db_url = os.environ.get("PRACTICE_DB_URL", "sqlite:///practice.db")
        engine = create_engine(db_url, echo=False)

        # Create tables if they don't exist
        from .db import DatasetSample, ExperienceRecord
        from sqlmodel import SQLModel
        SQLModel.metadata.create_all(engine)

        with Session(engine) as session:
            yield session


# ─── Experience cache ─────────────────────────────────────────────────────────

class ExperienceCache:
    """Cache experiences in the database to avoid recomputation."""

    @staticmethod
    def load_experiences(
        experiment_name: str,
        step: int,
    ) -> Optional[dict[str, str]]:
        """Load cached experiences for a given experiment and step."""
        try:
            from .db import ExperienceRecord
            from sqlmodel import select

            with SQLModelUtils.create_session() as session:
                records = session.exec(
                    select(ExperienceRecord).where(
                        ExperienceRecord.experiment_name == experiment_name,
                        ExperienceRecord.step == step,
                    )
                ).all()

                if records:
                    return {r.experience_key: r.experience_text for r in records}
        except Exception as e:
            get_logger(__name__).warning(f"Failed to load experience cache: {e}")

        return None

    @staticmethod
    def save_experiences(
        experiment_name: str,
        step: int,
        experiences: dict[str, str],
        epoch: int = 0,
        batch: int = 0,
    ) -> None:
        """Save experiences to the database."""
        try:
            from .db import ExperienceRecord

            with SQLModelUtils.create_session() as session:
                for key, text in experiences.items():
                    record = ExperienceRecord(
                        experiment_name=experiment_name,
                        step=step,
                        epoch=epoch,
                        batch=batch,
                        experience_key=key,
                        experience_text=text,
                    )
                    session.add(record)
                session.commit()
        except Exception as e:
            get_logger(__name__).warning(f"Failed to save experience cache: {e}")


# ─── Task Recorder ─────────────────────────────────────────────────────────────

@dataclass
class TaskRecorder:
    """Records practice progress, experiences, and statistics."""
    experiment_name: str
    experiences: dict[str, str] = field(default_factory=dict)
    stats: dict[str, Any] = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)

    def experiences_update(self, new_experiences: dict[str, str]) -> None:
        """Update experiences with new entries."""
        self.experiences.update(new_experiences)

    def stat_update(self, stats: dict[str, Any]) -> None:
        """Update statistics."""
        self.stats.update(stats)

    def log(self, message: str) -> None:
        """Add a log entry."""
        self.logs.append(message)


# ─── Config parser ────────────────────────────────────────────────────────────

def parse_training_free_grpo_config() -> "TrainingFreeGRPOConfig":
    """Parse TrainingFreeGRPO config from CLI args and YAML.

    Supports loading from configs/practice/ directory with CLI overrides.
    """
    import yaml

    from .config import (
        AgentConfig,
        AgentModelConfig,
        DataArguments,
        DataConfig,
        EvalConfig,
        ModelProviderConfig,
        ModelSettings,
        PracticeConfig,
        TrainingFreeGRPOConfig,
    )

    parser = argparse.ArgumentParser(description="Training-Free GRPO")
    parser.add_argument("--config_name", type=str, default=None, help="Config file name (without .yaml)")
    parser.add_argument("--experiment_name", type=str, default=None, help="Experiment ID override")
    parser.add_argument("--epochs", type=int, default=None, help="Number of epochs")
    parser.add_argument("--batch_size", type=int, default=None, help="Batch size")
    parser.add_argument("--restart_step", type=str, default=None, help="Restart step (null to use cache)")
    args, _ = parser.parse_known_args()

    if args.config_name:
        # Try to load from configs/practice/
        config_path = DIR_ROOT / "configs" / "practice" / f"{args.config_name}.yaml"
        if not config_path.exists():
            # Try configs/eval/
            config_path = DIR_ROOT / "configs" / "eval" / f"{args.config_name}.yaml"

        if config_path.exists():
            with open(config_path, "r") as f:
                raw = yaml.safe_load(f) or {}

            # Build config from YAML
            practice_dict = raw.get("practice", {})
            eval_dict = raw.get("evaluation", raw)  # some configs have evaluation at top level

            # Build agent config
            agent_dict = eval_dict.get("agent", {})
            model_dict = agent_dict.get("model", {})
            provider_dict = model_dict.get("model_provider", {})
            settings_dict = model_dict.get("model_settings", {})

            agent = AgentConfig(
                name=agent_dict.get("name", "practice-agent"),
                instructions=agent_dict.get("instructions", "You are a helpful assistant."),
                model=AgentModelConfig(
                    model_provider=ModelProviderConfig(
                        type=provider_dict.get("type", "chat.completions"),
                        model=provider_dict.get("model", "gpt-4o"),
                        base_url=provider_dict.get("base_url"),
                        api_key=provider_dict.get("api_key"),
                    ),
                    model_settings=ModelSettings(
                        temperature=settings_dict.get("temperature", 0.7),
                    ),
                ),
            )

            data_dict = eval_dict.get("data", {})
            eval_config = EvalConfig(
                exp_id=eval_dict.get("exp_id", args.experiment_name or "training-free-grpo"),
                agent=agent,
                data=DataConfig(
                    dataset=data_dict.get("dataset"),
                    type=data_dict.get("type", "single"),
                ),
                concurrency=eval_dict.get("concurrency", 64),
                pass_k=eval_dict.get("pass_k", 3),
                verify_filename=eval_dict.get("verify_filename"),
                verify_func_name=eval_dict.get("verify_func_name"),
            )

            practice = PracticeConfig(
                epochs=args.epochs or practice_dict.get("epochs", 5),
                batch_size=args.batch_size or practice_dict.get("batch_size", 32),
                grpo_n=practice_dict.get("grpo_n", 3),
                rollout_concurrency=practice_dict.get("rollout_concurrency", 64),
                rollout_temperature=practice_dict.get("rollout_temperature", 0.7),
                task_timeout=practice_dict.get("task_timeout", 3600),
                do_eval=practice_dict.get("do_eval", False),
                eval_strategy=practice_dict.get("eval_strategy", "epoch"),
                restart_step=None if args.restart_step == "null" else (
                    int(args.restart_step) if args.restart_step else practice_dict.get("restart_step")
                ),
                agent_objective=practice_dict.get("agent_objective", ""),
                learning_objective=practice_dict.get("learning_objective", ""),
                num_experiences_per_query=practice_dict.get("num_experiences_per_query", 1),
            )

            data_args = DataArguments(
                practice_dataset_name=raw.get("data", {}).get("practice_dataset_name", "PracticeDataset"),
            )

            config = TrainingFreeGRPOConfig(
                exp_id=eval_config.exp_id,
                evaluation=eval_config,
                practice=practice,
                data=data_args,
            )
            return config

    # Fallback: create default config from environment
    return _default_config_from_env(args)


def _default_config_from_env(args: Any = None) -> TrainingFreeGRPOConfig:
    """Create a default config from environment variables."""
    from .config import (
        AgentConfig,
        AgentModelConfig,
        DataArguments,
        DataConfig,
        EvalConfig,
        ModelProviderConfig,
        ModelSettings,
        PracticeConfig,
        TrainingFreeGRPOConfig,
    )

    model_type = os.environ.get("UTU_LLM_TYPE", "chat.completions")
    model_name = os.environ.get("UTU_LLM_MODEL", "gpt-4o")
    model_base_url = os.environ.get("UTU_LLM_BASE_URL")
    model_api_key = os.environ.get("UTU_LLM_API_KEY")

    agent = AgentConfig(
        name="practice-agent",
        instructions="You are a helpful assistant.",
        model=AgentModelConfig(
            model_provider=ModelProviderConfig(
                type=model_type,
                model=model_name,
                base_url=model_base_url,
                api_key=model_api_key,
            ),
            model_settings=ModelSettings(temperature=0.7),
        ),
    )

    eval_config = EvalConfig(
        exp_id=args.experiment_name if args else "training-free-grpo",
        agent=agent,
        data=DataConfig(),
    )

    practice = PracticeConfig(
        epochs=args.epochs if args and args.epochs else 5,
        batch_size=args.batch_size if args and args.batch_size else 32,
    )

    return TrainingFreeGRPOConfig(
        exp_id=eval_config.exp_id,
        evaluation=eval_config,
        practice=practice,
        data=DataArguments(),
    )
