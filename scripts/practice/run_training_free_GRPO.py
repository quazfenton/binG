#!/usr/bin/env python3
"""Command line interface for Training-free GRPO.

Usage:
    python scripts/practice/run_training_free_GRPO.py --config_name my_practice
    python scripts/practice/run_training_free_GRPO.py --config_name my_practice --epochs 5 --batch_size 64
"""

import asyncio
import sys
import os

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from packages.shared.agent.practice import TrainingFreeGRPO, parse_training_free_grpo_config


async def main():
    """Run TrainingFreeGRPO from command line."""
    config = parse_training_free_grpo_config()
    training_free_grpo = TrainingFreeGRPO(config)
    result = await training_free_grpo.run()
    print(f"Training-free GRPO completed. New agent config saved at: {result}")


if __name__ == "__main__":
    asyncio.run(main())
