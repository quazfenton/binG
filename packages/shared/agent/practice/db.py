"""
Database models and adapters for the practice module.

Adapted from Youtu-Agent's utu.db module.
Provides SQLModel classes for dataset samples and evaluation samples.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlmodel import Field, SQLModel


class DatasetSample(SQLModel, table=True):
    """A sample from a dataset (question-answer pair)."""
    __tablename__ = "dataset_samples"

    id: Optional[int] = Field(default=None, primary_key=True)
    dataset: str = Field(index=True)
    source: str = Field(default="training_free_grpo", index=True)
    question: str
    answer: Optional[str] = None
    index: int = Field(default=0)
    metadata_json: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class EvaluationSample(SQLModel):
    """A sample used during evaluation/practice rollout.

    This is NOT a table model — it's a data container passed between components.
    """
    dataset: str = ""
    dataset_index: int = 0
    source: str = "training_free_grpo"
    raw_question: str = ""
    correct_answer: Optional[str] = None
    response: Optional[str] = None
    reward: Optional[float] = None
    reasoning: Optional[str] = None
    trajectory: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    epoch: int = 0
    batch_idx: int = 0


class ExperienceRecord(SQLModel, table=True):
    """Stores extracted experiences from practice sessions."""
    __tablename__ = "experience_records"

    id: Optional[int] = Field(default=None, primary_key=True)
    experiment_name: str = Field(index=True)
    step: int = Field(index=True)
    epoch: int = 0
    batch: int = 0
    experience_key: str
    experience_text: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
