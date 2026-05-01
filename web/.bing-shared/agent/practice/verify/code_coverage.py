#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# Code Coverage Verifier
# =============================================================================
# Verifies that generated code achieves sufficient test coverage.
# Supports multiple coverage tools (pytest-cov, coverage.py, istanbul/coverage-js).
#
# Part of the Diversify Verifiers recommendation from agent-practice-review.md.

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .db import EvaluationSample


@dataclass
class CoverageResult:
    line_percent: float
    branch_percent: Optional[float]
    covered_lines: int
    total_lines: int
    missing_lines: list[int]
    report_format: str  # 'text', 'json', 'xml', 'html'


def run_coverage_command(
    source_path: str,
    test_path: str,
    coverage_type: str = 'line',
    tool: str = 'coverage',
) -> Optional[CoverageResult]:
    r'''
    Run coverage analysis on a source file and its tests.
    
    Args:
        source_path: Path to the source file to measure coverage for
        test_path: Path to the test file(s) to run
        coverage_type: 'line', 'branch', or 'both'
        tool: 'coverage' (Python) or 'jest' (JavaScript)
    
    Returns:
        CoverageResult with coverage metrics, or None if coverage failed
    '''
    
    if tool == 'coverage':
        return _run_python_coverage(source_path, test_path, coverage_type)
    elif tool == 'jest':
        return _run_jest_coverage(source_path, test_path, coverage_type)
    else:
        raise ValueError(f'Unknown coverage tool: {tool}')


def _run_python_coverage(
    source_path: str,
    test_path: str,
    coverage_type: str,
) -> Optional[CoverageResult]:
    '''Run coverage with Python coverage.py'''
    
    try:
        # Find the module name from the source path
        module_name = str(Path(source_path).stem)
        
        # Run coverage with JSON output
        result = subprocess.run(
            [
                'coverage', 'run',
                '--source', module_name,
                '-m', 'pytest', test_path,
                '-v', '--tb=short',
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        
        # Get coverage report as JSON
        json_result = subprocess.run(
            ['coverage', 'json', '-o', '/tmp/coverage.json'],
            capture_output=True,
            text=True,
        )
        
        if os.path.exists('/tmp/coverage.json'):
            with open('/tmp/coverage.json') as f:
                report = json.load(f)
            
            # Find the file in the report using precise path matching
            # Use normalized absolute paths to avoid subdirectory mismatches
            from pathlib import Path
            source_abs = str(Path(source_path).resolve())
            for file_data in report.get('files', []):
                # Compare resolved paths for accuracy
                file_abs = str(Path(file_data['path']).resolve())
                if file_abs == source_abs or file_data['path'].endswith(f'/{module_name}.py'):
                    return CoverageResult(
                        # Handle zero-statements case explicitly
                        num_statements = file_data['summary']['num_statements']
                        if num_statements == 0:
                            # File with no executable statements - report 0% coverage, not 100%
                            return CoverageResult(
                                line_percent=0.0,
                                branch_percent=file_data['summary'].get('branch_percent'),
                        covered_lines=file_data['summary']['covered_lines'],
                        total_lines=file_data['summary']['num_statements'],
                        missing_lines=file_data['summary'].get('missing_lines', []),
                        report_format='json',
                    )
        
        return None
        
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError) as e:
        # Fallback: try to parse text output
        return _parse_coverage_text_output(source_path)


def _run_jest_coverage(
    source_path: str,
    test_path: str,
    coverage_type: str,
) -> Optional[CoverageResult]:
    '''Run coverage with Jest (for JavaScript/TypeScript)'''
    
    try:
        result = subprocess.run(
            [
                'npx', 'jest',
                '--coverage',
                '--coverageReporters=json',
                test_path,
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        
        coverage_file = 'coverage/coverage-final.json'
        if os.path.exists(coverage_file):
            with open(coverage_file) as f:
                report = json.load(f)
            
            # Find the file in the coverage report
            for file_path, data in report.items():
                if source_path in file_path or file_path.endswith('.ts'):
                    statement_map = data.get('statementMap', {})
                    covered = sum(1 for s in data.get('s', {}).values() if s > 0)
                    total = len(statement_map)
                    
                    return CoverageResult(
                        line_percent=covered / max(total, 1) * 100,
                        branch_percent=data.get('branchMap') and _calc_branch_percent(data),
                        covered_lines=covered,
                        total_lines=total,
                        missing_lines=[],
                        report_format='json',
                    )
        
        return None
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _calc_branch_percent(coverage_data: dict) -> float:
    '''Calculate branch coverage percentage'''
    branches = coverage_data.get('b', {})
    if not branches:
        return 0.0
    
    covered = sum(1 for hits in branches.values() if all(h > 0 for h in hits))
    total = sum(len(hits) for hits in branches.values())
    
    return covered / max(total, 1) * 100


def _parse_coverage_text_output(source_path: str) -> Optional[CoverageResult]:
    '''Fallback parser for text-based coverage output'''
    
    try:
        result = subprocess.run(
            ['coverage', 'report', '--show-missing'],
            capture_output=True,
            text=True,
        )
        
        # Parse lines like: module.py    85%   75%    12   2
        for line in result.stdout.split('\n'):
            if source_path in line or Path(source_path).name in line:
                parts = line.split()
                if len(parts) >= 2:
                    try:
                        pct = float(parts[-1].replace('%', ''))
                        return CoverageResult(
                            line_percent=pct,
                            branch_percent=None,
                            covered_lines=0,  # Not parsed from text
                            total_lines=0,
                            missing_lines=[],
                            report_format='text',
                        )
                    except ValueError:
                        pass
        
        return None
    except Exception:
        return None


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    '''
    Verify that generated code has sufficient test coverage.
    
    Args:
        sample: EvaluationSample with:
            - raw_question: Description of the coding task
            - correct_answer: Expected coverage threshold (e.g., '80%')
            - response: Agent's code/response
            - trajectory: Full agent trajectory
            - metadata.source_path: Path to the generated source file
            - metadata.test_path: Path to the test file
        timeout_score: Score when verification times out
        **kwargs: May include 'llm' for LLM-based judgment
    
    Returns:
        dict: {'reward': 0.0-1.0, 'reasoning': str, 'coverage': CoverageResult}
    '''
    
    if not sample.response:
        return {'reward': 0.0, 'reasoning': 'No code generated'}
    
    source_path = sample.metadata.get('source_path') if sample.metadata else None
    test_path = sample.metadata.get('test_path') if sample.metadata else None
    
    if not source_path:
        # Try to find source file from response
        source_path = _extract_file_path(sample.response, ['.py', '.ts', '.js'])
    
    if not test_path:
        # Try to infer test path from source path
        test_path = _infer_test_path(source_path)
    
    if not source_path or not test_path:
        # Use LLM-based verification as fallback
        return _llm_based_coverage_verification(sample, kwargs)
    
    # Run actual coverage analysis
    try:
        coverage = run_coverage_command(source_path, test_path)
        
        if coverage is None:
            return _llm_based_coverage_verification(sample, kwargs)
        
        # Parse expected coverage from correct_answer (e.g., '80%')
        expected_pct = _parse_percentage(sample.correct_answer or '70%')
        actual_pct = coverage.line_percent
        
        if actual_pct >= expected_pct:
            reward = 1.0
            reasoning = f'✓ Coverage {actual_pct:.1f}% meets threshold {expected_pct:.1f}%'
        elif actual_pct >= expected_pct - 10:
            reward = 0.5
            reasoning = f'⚠ Coverage {actual_pct:.1f}% close to threshold {expected_pct:.1f}%'
        else:
            reward = 0.0
            reasoning = f'✗ Coverage {actual_pct:.1f}% below threshold {expected_pct:.1f}%'
        
        if coverage.branch_percent is not None:
            reasoning += f', branch coverage {coverage.branch_percent:.1f}%'
        
        return {
            'reward': reward,
            'reasoning': reasoning,
            'coverage': {
                'line_percent': coverage.line_percent,
                'branch_percent': coverage.branch_percent,
                'covered_lines': coverage.covered_lines,
                'total_lines': coverage.total_lines,
            },
        }
        
    except Exception as e:
        return _llm_based_coverage_verification(sample, kwargs, error=str(e))


def _extract_file_path(response: str, extensions: list[str]) -> Optional[str]:
    '''Extract file path from code block in response'''
    
    patterns = [
        r'(?:file|path):\/?([^\n]+\\.(?:py|ts|js))',
        r'`([^\n]+\\.(?:py|ts|js))`',
        r'(/[^\n]+\\.(?:py|ts|js))',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, response)
        if match:
            return match.group(1)
    
    return None


def _infer_test_path(source_path: Optional[str]) -> Optional[str]:
    '''Infer test file path from source file path'''
    
    if not source_path:
        return None
    
    source = Path(source_path)
    
    # Common test naming patterns
    test_candidates = [
        source.with_name(f'test_{source.name}'),
        source.with_name(f'{source.stem}_test{source.suffix}'),
        source.with_name(f'{source.stem}.test{source.suffix}'),
        Path('tests') / source.name,
        Path('__tests__') / source.name,
    ]
    
    for candidate in test_candidates:
        if candidate.exists():
            return str(candidate)
    
    return None


def _parse_percentage(text: str) -> float:
    '''Parse percentage from text (e.g., '80%', '80 percent', '80')'''
    
    match = re.search(r'(\b100|\b(?:[1-9]?[0-9]))%?', text)
    if match:
        return float(match.group(1))
    return 70.0  # Default threshold


def _llm_based_coverage_verification(
    sample: EvaluationSample,
    kwargs: dict,
    error: Optional[str] = None,
) -> dict:
    '''Fallback verification using LLM judgment'''
    
    llm = kwargs.get('llm')
    if not llm:
        return {
            'reward': 0.5,
            'reasoning': f'Coverage verification skipped (no test infrastructure: {error or "no paths"})',
        }
    
    prompt = f'''Evaluate the code quality and test coverage practices.

Task: {sample.raw_question}
Generated code:
{sample.response[:2000]}

Assess:
1. Does the code look testable? (no tight coupling, dependencies injectable)
2. Are there comments/docs explaining the logic?
3. Does it follow common testing patterns?
4. Would this be easy to cover with unit tests?

Score 0-1:
- 1.0: Well-structured, testable code with clear separation of concerns
- 0.5: Mostly testable but some issues (tight coupling, globals, etc.)
- 0.0: Hard to test (tight coupling, no abstraction, untestable patterns)

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
            score = float(match.group(1))
            return {
                'reward': score,
                'reasoning': f'LLM-based verification: {result[:100]}',
            }
    except Exception:
        pass
    
    return {
        'reward': 0.5,
        'reasoning': f'Coverage verification failed: {error or "unknown error"}',
    }