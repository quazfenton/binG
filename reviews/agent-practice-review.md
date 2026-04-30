# Codebase Review: Agent Learning & Practice (Self-Improving Agent)

## Overview
The `packages/shared/agent/practice` module implements a sophisticated Python-based "Self-Improvement" system for agents. It uses a novel technique called **Training-Free GRPO** (Group Relative Policy Optimization) to allow agents to learn from their own successes and failures without requiring traditional model fine-tuning.

## Key Components

### 1. Training-Free GRPO (`training_free_grpo.py`)
The high-level orchestrator of the learning process.
- **Iterative Improvement**: Manages "Epochs" and "Batches" of practice tasks.
- **Experience Extraction**: After each batch of tasks, it invokes the `ExperienceUpdater` to distill "Lessons Learned" into natural language instructions.
- **Config Generation**: Automatically produces new `.yaml` agent configurations where the learned experiences are appended to the system instructions.

### 2. Rollout Manager (`rollout_manager.py`)
The "Execution Environment" for practice.
- **Trajectory Capture**: Executes the agent on a dataset of problems and records the full thought/action trajectory.
- **Reward Calculation**: Uses a "Verifier" (programmatic or LLM-based) to score each solution.
- **Parallelism**: Implements robust async execution with semaphores and retries to handle large-scale LLM benchmarking.

### 3. Experience Updater (`experience_updater.py`)
The "Cognitive Processor" of the system.
- **Dual Summarization**: Analyzes both "What went right" in successful trajectories and "What went wrong" in failed ones.
- **Advantage Extraction**: Identifies patterns of behavior that lead to high rewards across different problem groups.
- **Self-Critique**: Uses a "Reviewer" LLM to compare new derived experiences against the existing knowledge base, preventing redundant or contradictory instructions.

## Findings

### 1. High Innovation in "Prompt-based Learning"
This module represents a highly advanced form of "Agentic RLHF". By distilling experiences into natural language instead of weight updates, the system is model-agnostic and incredibly cost-effective.

### 2. Robust Experimental Infrastructure
The use of `SQLModel` for experiment tracking and `pydantic` for configuration management indicates a high level of engineering maturity. The system is designed to be resumeable and auditable.

### 3. Logic: Learning Loop
1.  **Practice**: Rollout manager runs the agent on 32 problems.
2.  **Evaluate**: Verifier scores the results (e.g., Accuracy: 65%).
3.  **Distill**: Experience updater analyzes the 35% failures. It finds that the agent often forgets to check for null bytes in paths.
4.  **Codify**: A new experience is generated: "[Experience 1]: Always check for null bytes (\0) before calling FS tools."
5.  **Evolve**: The next version of the agent starts with this experience in its instructions.

## Recommended Actions

| Action | Priority | Reason |
| :--- | :--- | :--- |
| **Real-time Feedback** | High | Integrate the `ExperienceCache` with the live `Mem0` power so that agents can benefit from "Practice" results immediately without a YAML re-deploy. |
| **Diversify Verifiers** | Medium | Expand the `verify/` directory with more domain-specific reward functions (e.g., Code Coverage verifier, Security Scan verifier). |
| **Experience Pruning** | Medium | Implement an "Instruction Compression" step. As the number of experiences grows, the system prompt will become too long. Summarize similar experiences into unified "Principles". |
| **WASM Integration** | Low | Allow the Python-based rollout manager to invoke the WASM tools directly for faster verification of code-based tasks. |
