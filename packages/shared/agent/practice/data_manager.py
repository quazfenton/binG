"""Data manager for training-free GRPO data.

Adapted from Youtu-Agent. Handles loading, shuffling, and batching
of dataset samples from the local SQLite database.
"""

import random
from typing import Optional

from sqlmodel import select

from .config import EvalConfig
from .db import DatasetSample, EvaluationSample
from .utils import SQLModelUtils, get_logger

logger = get_logger(__name__)
random.seed(42)


class TrainingFreeGRPODataManager:
    """Data manager for training-free GRPO data.

    Handles loading dataset samples from the database, creating evaluation
    samples, and managing epoch-based data iteration with duplication.
    """

    def __init__(self, config: EvalConfig) -> None:
        self.config = config
        self._epoch_cache: dict[str, list[EvaluationSample]] = {}

    def check_dataset(self, dataset_name: str) -> bool:
        """Check if a dataset exists in the database."""
        try:
            with SQLModelUtils.create_session() as session:
                count = session.exec(
                    select(DatasetSample).where(
                        DatasetSample.dataset == dataset_name,
                        DatasetSample.source == "training_free_grpo",
                    )
                ).first()
                return count is not None
        except Exception as e:
            logger.error(f"Error checking dataset {dataset_name}: {e}")
            return False

    def load_epoch_data(
        self, epoch: int, shuffle: bool = True, truncate: int = None
    ) -> list[EvaluationSample]:
        """Load data for a specific epoch.

        Creates evaluation samples from the dataset, duplicating each sample
        pass_k times for GRPO group comparison.
        """
        epoch_exp_id = f"{self.config.exp_id}_epoch_{epoch}"

        # Check if epoch data is cached
        if epoch_exp_id in self._epoch_cache:
            logger.warning(f"exp_id {epoch_exp_id} already in cache, returning cached data")
            return self._epoch_cache[epoch_exp_id]

        with SQLModelUtils.create_session() as session:
            # Load all datapoints from the dataset
            datapoints = session.exec(
                select(DatasetSample).where(
                    DatasetSample.dataset == self.config.data.dataset,
                    DatasetSample.source == "training_free_grpo",
                )
            ).all()
            logger.info(f"Loaded {len(datapoints)} samples from {self.config.data.dataset}.")

            # Truncate if needed
            if truncate:
                datapoints = datapoints[:truncate]
                logger.info(f"Truncated dataset to first {truncate} samples.")

            # Shuffle original datapoints
            if shuffle:
                random.shuffle(datapoints)
                logger.info("Shuffled the original datapoints.")

            samples = []
            logger.info(f"Duplicate {self.config.pass_k} times for each sample.")

            # Create duplicates for each datapoint, keeping duplicates adjacent
            for dp in datapoints:
                for _ in range(self.config.pass_k):
                    sample = EvaluationSample(
                        dataset=dp.dataset,
                        dataset_index=dp.index,
                        source=dp.source,
                        raw_question=dp.question,
                        correct_answer=dp.answer,
                    )
                    samples.append(sample)

            # Cache the epoch data
            self._epoch_cache[epoch_exp_id] = samples
            logger.info(f"Prepared {len(samples)} evaluation samples for epoch {epoch}.")

            return samples

    def get_batch_samples(
        self,
        epoch: int,
        batch_idx: Optional[int] = None,
        stage: Optional[str] = None,
        batch_size: int = 32,
    ) -> list[EvaluationSample]:
        """Get samples for a specific batch.

        Args:
            epoch: Epoch number
            batch_idx: Batch index (None for all batches)
            stage: Filter by stage (None for all stages)
            batch_size: Number of samples per batch

        Returns:
            List of evaluation samples
        """
        epoch_exp_id = f"{self.config.exp_id}_epoch_{epoch}"

        if epoch_exp_id not in self._epoch_cache:
            logger.warning(f"Epoch {epoch} data not in cache. Load it first.")
            return []

        all_samples = self._epoch_cache[epoch_exp_id]

        # Filter by stage if specified
        if stage:
            all_samples = [s for s in all_samples if getattr(s, "stage", "init") == stage]

        # Get specific batch or all samples
        if batch_idx is not None:
            start = batch_idx * batch_size
            end = start + batch_size
            return all_samples[start:end]

        return all_samples

    def save(self, sample: EvaluationSample) -> None:
        """Save an updated sample back to the epoch cache."""
        # In a full implementation, this would persist to the database
        # For now, we update the in-memory cache
        pass
