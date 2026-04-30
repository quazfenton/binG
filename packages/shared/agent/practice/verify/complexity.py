#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# Complexity Verifier
# =============================================================================
# Verifies that generated code meets complexity requirements.
# Checks cyclomatic complexity, lines of code, function length, and nesting depth.
#
# Part of the Diversify Verifiers recommendation from agent-practice-review.md.

from __future__ import annotations

import ast
import re
import subprocess
from dataclasses import dataclass
from typing import Optional

from .db import EvaluationSample


@dataclass
class ComplexityResult:
    cyclomatic_complexity: int
    max_function_length: int
    max_nesting_depth: int
    total_lines: int
    function_count: int
    average_function_length: float
    issues: list[str]


class ComplexityAnalyzer(ast.NodeVisitor):
    '''AST-based complexity analyzer for Python code.'''
    
    def __init__(self):
        self.complexity_scores: dict[str, int] = {}
        self.function_lengths: dict[str, int] = {}
        self.nesting_depths: dict[str, int] = {}
        self.max_nesting: int = 0
        
        # Complexity-contributing node types
        self.complexity_nodes = (
            ast.If, ast.For, ast.While, ast.ExceptHandler,
            ast.With, ast.Assert, ast.Comprehension,
            ast.BoolOp, ast.Compare,
        )
    
    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        '''Visit function definition and analyze complexity.'''
        
        # Count complexity
        complexity = 1  # Base complexity
        max_depth = 0
        
        # Walk the function body to count complexity nodes and track depth
        for child in ast.walk(node):
            if isinstance(child, self.complexity_nodes):
                complexity += 1
        
        # Calculate nesting depth by traversing with depth tracking
        max_depth = self._calculate_nesting_depth(node)
        
        self.complexity_scores[node.name] = complexity
        self.function_lengths[node.name] = node.end_lineno - node.lineno + 1 if node.end_lineno else 0
        self.nesting_depths[node.name] = max_depth
        self.max_nesting = max(self.max_nesting, max_depth)
        
        self.generic_visit(node)
    
    visit_AsyncFunctionDef = visit_FunctionDef
    
    def _calculate_nesting_depth(self, node: ast.AST) -> int:
        '''Calculate maximum nesting depth within a node.'''
        max_depth = 0
        
        def walk_with_depth(n: ast.AST, depth: int) -> None:
            nonlocal max_depth
            max_depth = max(max_depth, depth)
            
            for child in ast.iter_child_nodes(n):
                if isinstance(child, (ast.If, ast.For, ast.While, ast.With, ast.ExceptHandler)):
                    walk_with_depth(child, depth + 1)
                else:
                    walk_with_depth(child, depth)
        
        walk_with_depth(node, 0)
        return max_depth
    
    def get_total_complexity(self) -> int:
        '''Get total cyclomatic complexity across all functions.'''
        return sum(self.complexity_scores.values())
    
    def get_max_complexity(self) -> int:
        '''Get maximum cyclomatic complexity of any function.'''
        return max(self.complexity_scores.values()) if self.complexity_scores else 0
    
    def get_max_function_length(self) -> int:
        '''Get length of the longest function.'''
        return max(self.function_lengths.values()) if self.function_lengths else 0
    
    def get_average_function_length(self) -> float:
        '''Get average function length.'''
        if not self.function_lengths:
            return 0.0
        return sum(self.function_lengths.values()) / len(self.function_lengths)


def analyze_complexity(code: str) -> ComplexityResult:
    '''
    Analyze code complexity using AST parsing.
    
    Args:
        code: Python source code to analyze
    
    Returns:
        ComplexityResult with metrics and issues
    '''
    try:
        tree = ast.parse(code)
        
        # Run analyzer
        analyzer = ComplexityAnalyzer()
        analyzer.visit(tree)
        
        # Generate issues
        issues = []
        
        max_complexity = analyzer.get_max_complexity()
        if max_complexity > 10:
            issues.append(f'High cyclomatic complexity: max={max_complexity} (threshold: 10)')
        elif max_complexity > 5:
            issues.append(f'Moderate cyclomatic complexity: max={max_complexity}')
        
        max_length = analyzer.get_max_function_length()
        if max_length > 50:
            issues.append(f'Long function detected: {max_length} lines (threshold: 50)')
        
        max_nesting = analyzer.max_nesting
        if max_nesting > 4:
            issues.append(f'Deep nesting detected: {max_nesting} levels (threshold: 4)')
        
        return ComplexityResult(
            cyclomatic_complexity=analyzer.get_total_complexity(),
            max_function_length=max_length,
            max_nesting_depth=max_nesting,
            total_lines=code.count('\n') + 1,
            function_count=len(analyzer.complexity_scores),
            average_function_length=analyzer.get_average_function_length(),
            issues=issues,
        )
        
    except SyntaxError as e:
        return ComplexityResult(
            cyclomatic_complexity=0,
            max_function_length=0,
            max_nesting_depth=0,
            total_lines=code.count('\n') + 1,
            function_count=0,
            average_function_length=0.0,
            issues=[f'Syntax error: {e}'],
        )


def run_radon_analysis(code: str, timeout: int = 30) -> Optional[dict]:
    '''
    Run Radon complexity analysis (if available).
    
    Args:
        code: Python code to analyze
        timeout: Analysis timeout in seconds
    
    Returns:
        dict with Radon metrics, or None if unavailable
    '''
    try:
        import tempfile
        import json
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        result = subprocess.run(
            ['radon', 'cc', '-a', '-j', temp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        import os
        os.unlink(temp_path)
        
        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return None
        
        return None
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    '''
    Verify that generated code meets complexity requirements.
    
    Args:
        sample: EvaluationSample with:
            - raw_question: Description of the coding task
            - correct_answer: Complexity requirements (e.g., 'max complexity 5')
            - response: Agent's code
            - trajectory: Full agent trajectory
        timeout_score: Score when verification times out
        **kwargs: May include 'llm' for LLM-based judgment
    
    Returns:
        dict: {'reward': 0.0-1.0, 'reasoning': str, 'complexity': ComplexityResult}
    '''
    
    if not sample.response:
        return {'reward': 0.0, 'reasoning': 'No code generated'}
    
    code = sample.response
    
    # Parse complexity requirements from correct_answer
    requirements = _parse_complexity_requirements(sample.correct_answer or '')
    
    # Analyze complexity
    result = analyze_complexity(code)
    
    # Also try Radon if available
    radon_result = run_radon_analysis(code)
    if radon_result:
        # Use Radon results if available (more comprehensive)
        result = _merge_radon_results(result, radon_result)
    
    # Calculate reward
    reward = 1.0
    reasoning_parts = []
    
    # Check cyclomatic complexity
    max_cc = requirements.get('max_cyclomatic_complexity', 10)
    if result.max_function_length > 50 and 'Long function' not in result.issues:
        result.issues.append(f'Long function: {result.max_function_length} lines')
    
    for issue in result.issues:
        if 'High cyclomatic complexity' in issue:
            reward *= 0.6
            reasoning_parts.append('high complexity')
        elif 'Moderate cyclomatic complexity' in issue:
            reward *= 0.8
            reasoning_parts.append('moderate complexity')
        elif 'Long function' in issue:
            reward *= 0.7
            reasoning_parts.append('long function')
        elif 'Deep nesting' in issue:
            reward *= 0.7
            reasoning_parts.append('deep nesting')
        elif 'Syntax error' in issue:
            reward = 0.0
            reasoning_parts.append('syntax error')
    
    if not reasoning_parts:
        if result.cyclomatic_complexity == 0:
            reasoning = '⚠ Code could not be parsed for complexity analysis'
            reward = 0.5
        else:
            reasoning = f'✓ Complexity acceptable: CC={result.cyclomatic_complexity}, nesting={result.max_nesting_depth}'
    else:
        reasoning = f'⚠ Complexity issues: {result.issues[0] if result.issues else reasoning_parts[0]}'
    
    return {
        'reward': max(0.0, reward),
        'reasoning': reasoning,
        'complexity': {
            'cyclomatic_complexity': result.cyclomatic_complexity,
            'max_function_length': result.max_function_length,
            'max_nesting_depth': result.max_nesting_depth,
            'total_lines': result.total_lines,
            'function_count': result.function_count,
            'average_function_length': result.average_function_length,
            'issues': result.issues,
        },
    }


def _parse_complexity_requirements(text: str) -> dict:
    '''Parse complexity requirements from text.'''
    
    requirements = {
        'max_cyclomatic_complexity': 10,
        'max_function_length': 50,
        'max_nesting_depth': 4,
    }
    
    text_lower = text.lower()
    
    # Parse CC requirements
    cc_match = re.search(r'cc[:\/\/]?\/?\/?\/?\/?(\b10|\b15|\b20|\b5)', text_lower)
    if cc_match:
        requirements['max_cyclomatic_complexity'] = int(cc_match.group(1))
    
    # Parse length requirements
    len_match = re.search(r'(?:max\\s+)?(?:function\\s+)?(?:length|lines?)[\\s:]*(?:of\\s+)?(\\d+)', text_lower)
    if len_match:
        requirements['max_function_length'] = int(len_match.group(1))
    
    # Parse nesting requirements
    nest_match = re.search(r'(?:max\\s+)?(?:nesting|depth)[\\s:]*(?:of\\s+)?(\\d+)', text_lower)
    if nest_match:
        requirements['max_nesting_depth'] = int(nest_match.group(1))
    
    return requirements


def _merge_radon_results(ast_result: ComplexityResult, radon: dict) -> ComplexityResult:
    '''Merge Radon analysis results with AST results.'''
    
    if not radon or not isinstance(radon, dict):
        return ast_result
    
    # Radon provides per-function CC scores
    functions = radon.get('functions', [])
    if functions:
        max_cc = max(f.get('complexity', 0) for f in functions)
        if max_cc > ast_result.cyclomatic_complexity:
            ast_result.cyclomatic_complexity = max_cc
    
    return ast_result


def llm_based_complexity_check(sample: EvaluationSample, llm) -> dict:
    '''LLM-based complexity assessment as fallback.'''
    
    prompt = f'''Assess the complexity and structure quality of this code.

Task: {sample.raw_question}
Code:
{sample.response[:2000]}

Check for:
1. Functions that are too long (>50 lines)
2. Deep nesting (>4 levels)
3. Complex conditionals or loops
4. Too many responsibilities in single functions
5. Code that could be refactored into smaller pieces

Score 0-1:
- 1.0: Clean, well-structured code with appropriate complexity
- 0.5: Some complexity issues but generally manageable
- 0.0: Excessive complexity, hard to understand/maintain

Respond with just the number and a one-line reason.'''
    
    try:
        import asyncio
        result = asyncio.get_event_loop().run_until_complete(
            llm.chat_completion(
                messages=[{'role': 'user', 'content': prompt}],
                temperature=0.3,
            )
        )
        
        match = re.search(r'([0-9]*\\.?[0-9]+)', result)
        if match:
            return {
                'reward': float(match.group(1)),
                'reasoning': f'LLM complexity check: {result[:100]}',
            }
    except Exception:
        pass
    
    return {'reward': 0.5, 'reasoning': 'Complexity check unavailable'}