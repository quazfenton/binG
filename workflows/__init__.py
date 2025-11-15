"""
Fast-Agent Workflows Package
"""

from .chaining import AgentChain, ChainConfig
from .parallel import ParallelAgents, ParallelConfig, AggregationStrategy
from .router import AgentRouter, RouterConfig, RoutingStrategy
from .evaluator import AgentEvaluator, EvaluatorConfig, EvaluationMetric

__all__ = [
    # Chaining
    'AgentChain',
    'ChainConfig',
    
    # Parallel
    'ParallelAgents',
    'ParallelConfig',
    'AggregationStrategy',
    
    # Router
    'AgentRouter',
    'RouterConfig',
    'RoutingStrategy',
    
    # Evaluator
    'AgentEvaluator',
    'EvaluatorConfig',
    'EvaluationMetric',
]

__version__ = '1.0.0'
