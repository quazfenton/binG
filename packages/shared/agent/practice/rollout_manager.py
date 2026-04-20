"""Rollout manager for practice with sample batching support.

Adapted from Youtu-Agent. Simplified to remove BaseBenchmark dependency.
"""

import asyncio
import json

from agents import custom_span
from tqdm import tqdm

from .config import EvalConfig
from .data_manager import TrainingFreeGRPODataManager
from .db import EvaluationSample
from .utils import TaskRecorder, get_logger

logger = get_logger(__name__, "INFO")


class RolloutManager:
    """Rollout manager that supports processing samples in batches.

    Processes samples through rollout (agent execution) and judging (reward calculation).

    Attributes:
        config (EvalConfig): Evaluation configuration
        dataset (TrainingFreeGRPODataManager): Data manager
        batch_size (int): Size of each batch
        task_timeout (int): Timeout per task in seconds
        max_retries (int): Maximum retry attempts per sample
    """

    def __init__(
        self,
        config: EvalConfig,
        batch_size: int,
        task_timeout: int = 3600,
        max_retries: int = 3,
    ) -> None:
        self.config = config
        self.dataset = TrainingFreeGRPODataManager(config)
        self.batch_size = batch_size
        self.task_timeout = task_timeout
        self.max_retries = max_retries
        self.curr_epoch: int = 0

    def load_epoch_data(self, epoch: int, shuffle: bool = True, truncate: int = None) -> list[EvaluationSample]:
        """Prepare data for a specific epoch."""
        epoch_data = self.dataset.load_epoch_data(epoch, shuffle=shuffle, truncate=truncate)
        self.curr_epoch = epoch
        return epoch_data

    async def main(
        self,
        batch_idx: int | None = None,
        recorder: TaskRecorder | None = None,
        use_cache: bool = True,
    ) -> tuple[list[EvaluationSample], dict]:
        """Run the full rollout pipeline for a specific batch or all batches.

        Args:
            batch_idx: Index of the batch to process. If None, processes all batches.
            recorder: Recorder to track progress.
            use_cache: Whether to use cached results.

        Returns:
            Tuple of (rollouts, statistics dict)
        """
        rollouts, stat = await self._run_batch(batch_idx, recorder, use_cache)
        logger.info("Cleaning up...")
        await self.cleanup()
        return rollouts, stat

    async def _run_batch(
        self,
        batch_idx: int | None,
        recorder: TaskRecorder | None = None,
        use_cache: bool = True,
    ) -> tuple[list[EvaluationSample], dict]:
        """Run the complete pipeline for a specific batch."""
        logger.info(f"Running batch {batch_idx}...")

        # Preprocess samples
        self.preprocess_batch(batch_idx, recorder, use_cache)

        # Rollout: run agent on each sample
        with custom_span("Rollout batch samples"):
            await self.rollout_batch(batch_idx)

        # Judge: compute rewards
        with custom_span("Judge batch samples"):
            await self.judge_batch(batch_idx)

        # Get stats
        logger.info(f"Running stat for batch {batch_idx}...")
        stat = await self.stat_batch(batch_idx)

        # Return rollouts that have been judged
        rollouts = self._get_batch_samples(batch_idx=batch_idx, stage="judged")
        return rollouts, stat.get("metrics", {})

    def preprocess_batch(
        self,
        batch_idx: int | None,
        recorder: TaskRecorder | None = None,
        use_cache: bool = True,
    ) -> list[EvaluationSample]:
        """Preprocess samples in a specific batch."""
        samples_to_process = self._get_batch_samples(
            batch_idx=batch_idx,
            stage="init" if use_cache else None,
        )
        logger.info(f"Preprocessing {len(samples_to_process)} samples in batch...")

        results = []
        for sample in tqdm(samples_to_process, desc="Preprocessing batch"):
            processed_sample = self.preprocess_one(sample, recorder)
            if processed_sample is not None:
                results.append(processed_sample)

        logger.info(f"Successfully preprocessed {len(results)} samples in batch.")
        return results

    def preprocess_one(
        self, sample: EvaluationSample, recorder: TaskRecorder | None = None
    ) -> EvaluationSample:
        """Preprocess a single sample."""
        # In the full implementation, this would call a processor based on sample.source
        # For the simplified version, we just mark it as ready
        self.dataset.save(sample)
        return sample

    async def rollout_batch(self, batch_idx: int | None = None) -> list[EvaluationSample]:
        """Rollout (run agent) on samples in a specific batch."""
        samples_to_process = self._get_batch_samples(batch_idx=batch_idx, stage="init")
        logger.info(f"Rolling out {len(samples_to_process)} samples in batch...")

        semaphore = asyncio.Semaphore(self.config.concurrency)

        async def rollout_with_semaphore(item: EvaluationSample):
            async with semaphore:
                for attempt in range(self.max_retries):
                    try:
                        result = await asyncio.wait_for(
                            self.rollout_one(item), timeout=self.task_timeout
                        )
                        return result
                    except TimeoutError:
                        logger.warning(
                            f"Rollout timeout ({self.task_timeout}s) on attempt {attempt + 1}/{self.max_retries}"
                        )
                    except Exception as e:
                        logger.warning(
                            f"Rollout error on attempt {attempt + 1}/{self.max_retries} for sample: {e}"
                        )
                logger.error(
                    f"Rollout failed after {self.max_retries} attempts "
                    f"for sample '{item.raw_question[:80]}...'",
                    exc_info=True,
                )
                return None

        tasks = [rollout_with_semaphore(item) for item in samples_to_process]
        results = []
        for task in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="Rolling out batch"):
            result = await task
            if result is not None:
                results.append(result)

        logger.info(f"Successfully rolled out {len(results)} samples in batch.")
        return results

    async def rollout_one(self, sample: EvaluationSample) -> EvaluationSample:
        """Run a single sample rollout.

        This should be overridden or configured with an agent runner.
        Default implementation uses the configured agent to answer the question.
        """
        # Placeholder: in a full implementation, this would invoke the agent
        # with the sample's raw_question and record the response.
        # The agent is configured via self.config.agent
        sample.response = "Not implemented — configure a runner."
        sample.stage = "rollout"
        self.dataset.save(sample)
        return sample

    async def judge_batch(self, batch_idx: int | None = None) -> list[EvaluationSample]:
        """Judge (compute rewards for) samples in a specific batch."""
        samples_to_process = self._get_batch_samples(batch_idx=batch_idx, stage="rollout")
        logger.info(f"Judging {len(samples_to_process)} samples in batch...")

        semaphore = asyncio.Semaphore(getattr(self.config, "judge_concurrency", self.config.concurrency))

        async def judge_with_semaphore(item: EvaluationSample):
            async with semaphore:
                try:
                    return await self.judge_one(item)
                except Exception as e:
                    logger.error(f"Error judging sample: {e}", exc_info=True)
                    return None

        tasks = [judge_with_semaphore(item) for item in samples_to_process]
        results = []
        for task in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="Judging batch"):
            result = await task
            if result is not None:
                results.append(result)

        logger.info(f"Successfully judged {len(results)} samples in batch.")
        return results

    async def judge_one(self, sample: EvaluationSample) -> EvaluationSample:
        """Judge a single sample.

        Loads verification function and computes reward.
        """
        # Try to load verification function
        verify_func = self._load_verify_func()

        if verify_func is None:
            # No verifier — default to checking if response matches answer
            if sample.correct_answer and sample.response:
                match = sample.correct_answer.strip().lower() == sample.response.strip().lower()
                sample.reward = 1.0 if match else 0.0
            else:
                sample.reward = 0.0
        else:
            result = verify_func(sample)
            sample.reward = result.get("reward", 0.0)
            sample.reasoning = result.get("reasoning")

        sample.stage = "judged"
        self.dataset.save(sample)
        return sample

    async def stat_batch(self, batch_idx: int | None = None) -> dict:
        """Generate statistics for samples in a specific batch."""
        judged_samples = self._get_batch_samples(batch_idx=batch_idx, stage="judged")
        logger.info(f"Generating stats from {len(judged_samples)} samples in batch:")

        if not judged_samples:
            return {"metrics": {"accuracy": 0.0, "count": 0}}

        rewards = [s.reward for s in judged_samples if s.reward is not None]
        accuracy = sum(rewards) / len(rewards) if rewards else 0.0

        stats = {
            "metrics": {
                "accuracy": accuracy,
                "count": len(judged_samples),
                "mean_reward": accuracy,
                "std_reward": (sum((r - accuracy) ** 2 for r in rewards) / len(rewards)) ** 0.5 if len(rewards) > 1 else 0.0,
            }
        }

        logger.info(json.dumps(stats, indent=4, ensure_ascii=False))
        return stats

    def _get_batch_samples(self, batch_idx: int | None = None, stage: str = None) -> list[EvaluationSample]:
        """Get samples for a specific batch."""
        samples = self.dataset.get_batch_samples(
            epoch=self.curr_epoch,
            batch_idx=batch_idx,
            stage=stage,
            batch_size=self.batch_size,
        )
        return samples

    def _load_verify_func(self):
        """Load verification function from config."""
        if not self.config.verify_filename or not self.config.verify_func_name:
            return None

        import importlib.util
        import os

        # Try to load from practice/verify/ directory
        verify_path = os.path.join(os.path.dirname(__file__), "verify", self.config.verify_filename)
        if not os.path.exists(verify_path):
            return None

        spec = importlib.util.spec_from_file_location("verify_module", verify_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        return getattr(module, self.config.verify_func_name, None)

    async def cleanup(self) -> None:
        """Clean up resources."""
        pass
