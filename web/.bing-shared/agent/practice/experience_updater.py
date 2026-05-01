"""
Experience updater for training-free GRPO.

Adapted from Youtu-Agent. Processes rollout trajectories to extract
actionable experiences that improve future agent performance.
"""

import asyncio
import copy
import json
import re
from collections import defaultdict

from agents import custom_span
from tqdm import tqdm

from .config import AgentConfig
from .db import EvaluationSample
from .utils import FileUtils, SimplifiedAsyncOpenAI, get_logger, TaskRecorder

logger = get_logger(__name__)


class ExperienceUpdater:
    """Extracts and updates experiences from rollout trajectories.

    Uses a multi-step process:
    1. Summarize each rollout trajectory
    2. Group similar rollouts and extract common advantages
    3. Critique and refine experiences
    """

    def __init__(self, config: AgentConfig, agent_objective: str, learning_objective: str):
        self.config = config
        self.agent_objective = agent_objective
        self.learning_objective = learning_objective
        self.prompts = FileUtils.load_prompts("experience.yaml")
        self.llm = SimplifiedAsyncOpenAI(
            **config.model.model_provider.model_dump()
        )

    async def run(
        self,
        rollouts: list[EvaluationSample],
        recorder: TaskRecorder,
        concurrency: int = 16,
        given_ground_truth: bool = True,
        num_experiences: int = 2,
    ) -> dict[str, str]:
        """Update experiences based on rollouts.

        Args:
            rollouts: List of evaluated samples
            recorder: Task recorder for progress tracking
            concurrency: Number of concurrent LLM calls
            given_ground_truth: Whether ground truth answers are available
            num_experiences: Number of experiences to extract per query

        Returns:
            Dictionary of experience key -> experience text
        """
        # 1. Summarize trajectory for each rollout
        with custom_span("Trajectory Summarization"):
            problem_to_summarized_rollouts = await self._single_rollout_summary(
                rollouts=rollouts,
                concurrency=concurrency,
                given_ground_truth=given_ground_truth,
            )

        # 2. Generate semantic group advantages based on summarized rollouts
        with custom_span("Semantic Group Advantage"):
            new_experiences = await self._group_advantage(
                problem_to_summarized_rollouts=problem_to_summarized_rollouts,
                concurrency=concurrency,
                given_ground_truth=given_ground_truth,
                num_experiences=num_experiences,
            )

        # 3. Group update experiences
        with custom_span("Group update"):
            critiques = await self._group_update(
                recorder=recorder,
                new_experiences=new_experiences,
                concurrency=concurrency,
            )

        # 4. Generate final updated experiences
        with custom_span("Generate final experiences"):
            final_experiences = await self._generate_final_experiences(
                recorder=recorder,
                new_experiences=new_experiences,
                critiques=critiques,
                concurrency=concurrency,
            )

        return final_experiences

    async def _single_rollout_summary(
        self,
        rollouts: list[EvaluationSample],
        concurrency: int = 16,
        given_ground_truth: bool = True,
    ) -> dict[str, list[EvaluationSample]]:
        """Summarize each rollout trajectory.

        Groups rollouts by problem and summarizes successful vs failed ones.
        """
        # Group by problem
        problem_to_rollouts = defaultdict(list)
        for rollout in rollouts:
            problem_to_rollouts[rollout.raw_question].append(rollout)

        # Separate correct and wrong rollouts
        problem_to_summarized_rollouts = {}
        semaphore = asyncio.Semaphore(concurrency)

        async def summarize_problem(problem: str, samples: list[EvaluationSample]):
            async with semaphore:
                correct_rollouts = [s for s in samples if (s.reward or 0) > 0.5]
                wrong_rollouts = [s for s in samples if (s.reward or 0) <= 0.5]

                summary = {}

                if correct_rollouts:
                    # Summarize correct solutions
                    trajectories = "\n---\n".join([
                        f"Solution {i+1}:\n{s.response or ''}"
                        for i, s in enumerate(correct_rollouts)
                    ])

                    prompt = self.prompts.get("summarize_correct", {}).get("user", "").format(
                        problem=problem,
                        correct_answer=(correct_rollouts[0].correct_answer or ""),
                        trajectories=trajectories,
                    )

                    if prompt:
                        try:
                            summary["correct"] = await self.llm.chat_completion(
                                messages=[{"role": "user", "content": prompt}],
                                temperature=0.3,
                            )
                        except Exception as e:
                            logger.warning(f"Failed to summarize correct solutions: {e}")
                            summary["correct"] = trajectories

                if wrong_rollouts:
                    # Summarize failed solutions
                    trajectories = "\n---\n".join([
                        f"Failed Solution {i+1}:\n{s.response or ''}"
                        for i, s in enumerate(wrong_rollouts)
                    ])

                    prompt = self.prompts.get("summarize_wrong", {}).get("user", "").format(
                        problem=problem,
                        correct_answer=(wrong_rollouts[0].correct_answer or ""),
                        trajectories=trajectories,
                    )

                    if prompt:
                        try:
                            summary["wrong"] = await self.llm.chat_completion(
                                messages=[{"role": "user", "content": prompt}],
                                temperature=0.3,
                            )
                        except Exception as e:
                            logger.warning(f"Failed to summarize wrong solutions: {e}")
                            summary["wrong"] = trajectories

                problem_to_summarized_rollouts[problem] = summary

        tasks = [
            summarize_problem(problem, samples)
            for problem, samples in problem_to_rollouts.items()
        ]

        for task in tqdm(asyncio.as_completed(tasks), total=len(tasks), desc="Summarizing rollouts"):
            await task

        return problem_to_summarized_rollouts

    async def _group_advantage(
        self,
        problem_to_summarized_rollouts: dict[str, dict],
        concurrency: int = 16,
        given_ground_truth: bool = True,
        num_experiences: int = 2,
    ) -> list[dict]:
        """Extract advantages from groups of similar problems."""
        # Combine all summaries into one context
        all_problems_text = "\n\n".join([
            f"Problem: {problem}\n"
            f"Correct solutions: {summary.get('correct', 'None')}\n"
            f"Wrong solutions: {summary.get('wrong', 'None')}"
            for problem, summary in problem_to_summarized_rollouts.items()
        ])

        prompt = self.prompts.get("group_advantage", {}).get("user", "").format(
            problems=all_problems_text,
            num_experiences=num_experiences,
            agent_objective=self.agent_objective,
        )

        if not prompt:
            # Fallback: create simple experiences from correct solutions
            experiences = []
            for problem, summary in problem_to_summarized_rollouts.items():
                if summary.get("correct"):
                    experiences.append({
                        "experience": summary["correct"][:500],
                        "problem_type": "unknown",
                    })
            return experiences[:num_experiences]

        try:
            response = await self.llm.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
            )

            # Parse JSON response
            experiences = self._parse_experience_json(response)
            return experiences
        except Exception as e:
            logger.warning(f"Failed to extract group advantages: {e}")
            # Fallback
            return [{"experience": f"Practice on: {list(problem_to_summarized_rollouts.keys())[:3]}", "problem_type": "general"}]

    async def _group_update(
        self,
        recorder: TaskRecorder,
        new_experiences: list[dict],
        concurrency: int = 16,
    ) -> list[dict]:
        """Critique and refine new experiences against existing ones."""
        existing_experiences = recorder.experiences or {}
        critiques = []

        for i, exp in enumerate(new_experiences):
            experience_text = exp.get("experience", "")
            problem_type = exp.get("problem_type", "general")

            # Check if this is a refinement of an existing experience
            prompt = self.prompts.get("group_update", {}).get("user", "").format(
                existing=json.dumps(existing_experiences, indent=2),
                new_experience=experience_text,
                problem_type=problem_type,
            )

            if prompt:
                try:
                    critique = await self.llm.chat_completion(
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                    )
                    critiques.append({"index": i, "critique": critique})
                except Exception as e:
                    logger.warning(f"Failed to critique experience {i}: {e}")
                    critiques.append({"index": i, "critique": "No critique available."})

        return critiques

    async def _generate_final_experiences(
        self,
        recorder: TaskRecorder,
        new_experiences: list[dict],
        critiques: list[dict],
        concurrency: int = 16,
    ) -> dict[str, str]:
        """Generate final refined experiences."""
        final_experiences = {}

        for i, exp in enumerate(new_experiences):
            experience_text = exp.get("experience", "")
            critique = critiques[i]["critique"] if i < len(critiques) else ""

            prompt = self.prompts.get("generate_final", {}).get("user", "").format(
                experience=experience_text,
                critique=critique,
                learning_objective=self.learning_objective,
            )

            if prompt:
                try:
                    final_exp = await self.llm.chat_completion(
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.3,
                    )
                    key = f"Experience {len(recorder.experiences) + len(final_experiences) + 1}"
                    final_experiences[key] = final_exp
                except Exception as e:
                    logger.warning(f"Failed to generate final experience {i}: {e}")
                    key = f"Experience {len(recorder.experiences) + len(final_experiences) + 1}"
                    final_experiences[key] = experience_text

        return final_experiences

    def _parse_experience_json(self, response: str) -> list[dict]:
        """Parse experience JSON from LLM response."""
        try:
            # Try to find JSON array in response
            match = re.search(r'\[[\s\S]*\]', response)
            if match:
                return json.loads(match.group())
        except json.JSONDecodeError:
            pass

        # Fallback: treat entire response as a single experience
        return [{"experience": response, "problem_type": "general"}]
