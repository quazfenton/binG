#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# Style Verifier
# =============================================================================
# Verifies that generated code follows style guidelines (PEP8, naming conventions).
# Supports multiple linters (Ruff, Flake8, Pylint) with fallback to regex checks.
#
# Part of the Diversify Verifiers recommendation from agent-practice-review.md.

from __future__ import annotations

import ast
import re
import subprocess
from dataclasses import dataclass, field
from typing import Optional

from .db import EvaluationSample


@dataclass
class StyleResult:
    issues: list[StyleIssue]
    line_count: int
    blank_lines: int
    comment_lines: int
    docstring_count: int
    max_line_length: int
    
    @property
    def error_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == 'error')
    
    @property
    def warning_count(self) -> int:
        return sum(1 for i in self.issues if i.severity == 'warning')


@dataclass
class StyleIssue:
    code: str
    message: str
    line: int
    column: Optional[int]
    severity: str  # 'error', 'warning', 'info'
    rule: str  # 'naming', 'formatting', 'import', 'convention'


# Naming convention rules
NAMING_PATTERNS = {
    'class': r'^[A-Z][a-zA-Z0-9]*$',
    'function': r'^[a-z_][a-z0-9_]*$',
    'variable': r'^[a-z_][a-z0-9_]*$',
    'constant': r'^[A-Z][A-Z0-9_]*$',
    'private': r'^_[a-z_][a-z0-9_]*$',
    'protected': r'^_[a-z_][a-z0-9_]*$',
    'dunder': r'^__[a-z]+__$',
}

# Style patterns to check
STYLE_PATTERNS = {
    'trailing_whitespace': (r'[ \t]+$', 'warning', 'Trailing whitespace'),
    'tabs': (r'\t', 'warning', 'Tab character found (use spaces)'),
    'missing_docstring': (r'^\ndef [a-z_]', 'info', 'Function missing docstring'),
    'long_import_line': (r'^import [^\n]{100,}$', 'warning', 'Import line too long'),
    'multiple_imports': (r'^from \b\b[^\n]{80,}$', 'warning', 'Multiple imports on one line'),
}


class StyleAnalyzer:
    '''Analyzes Python code style using AST and regex patterns.'''
    
    def __init__(self):
        self.issues: list[StyleIssue] = []
        self.line_count: int = 0
        self.blank_lines: int = 0
        self.comment_lines: int = 0
        self.docstring_count: int = 0
        self.max_line_length: int = 0
    
    def analyze(self, code: str) -> StyleResult:
        '''Run full style analysis on code.'''
        
        lines = code.split('\n')
        self.line_count = len(lines)
        
        for i, line in enumerate(lines, 1):
            self._check_line_length(line, i)
            
            if line.strip() == '':
                self.blank_lines += 1
            elif line.strip().startswith('#'):
                self.comment_lines += 1
        
        # Parse AST for deeper analysis
        try:
            tree = ast.parse(code)
            self._analyze_ast(tree)
        except SyntaxError:
            pass
        
        # Regex-based checks
        self._check_regex_patterns(code)
        
        return StyleResult(
            issues=self.issues,
            line_count=self.line_count,
            blank_lines=self.blank_lines,
            comment_lines=self.comment_lines,
            docstring_count=self.docstring_count,
            max_line_length=self.max_line_length,
        )
    
    def _check_line_length(self, line: str, line_num: int) -> None:
        '''Check line length and update max.'''
        
        length = len(line.rstrip('\n'))
        self.max_line_length = max(self.max_line_length, length)
        
        if length > 100:
            self.issues.append(StyleIssue(
                code='E501',
                message=f'Line too long ({length} > 100 characters)',
                line=line_num,
                column=None,
                severity='warning',
                rule='formatting',
            ))
    
    def _analyze_ast(self, tree: ast.AST) -> None:
        '''Analyze AST for naming conventions and structure.'''
        
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                self._check_naming(node.name, 'class', node.lineno)
                if self._has_docstring(node):
                    self.docstring_count += 1
                else:
                    self.issues.append(StyleIssue(
                        code='D100',
                        message='Missing docstring in public class',
                        line=node.lineno,
                        column=None,
                        severity='info',
                        rule='convention',
                    ))
                    
            elif isinstance(node, ast.FunctionDef):
                if not node.name.startswith('_'):
                    self._check_naming(node.name, 'function', node.lineno)
                    if self._has_docstring(node):
                        self.docstring_count += 1
                    else:
                        self.issues.append(StyleIssue(
                            code='D100',
                            message='Missing docstring in public function',
                            line=node.lineno,
                            column=None,
                            severity='info',
                            rule='convention',
                        ))
    
    def _check_naming(self, name: str, expected_type: str, line: int) -> None:
        '''Check if name follows naming conventions.'''
        
        if expected_type not in NAMING_PATTERNS:
            return
        
        pattern = NAMING_PATTERNS[expected_type]
        if not re.match(pattern, name):
            suggestions = _get_naming_suggestions(name, expected_type)
            self.issues.append(StyleIssue(
                code=f'N{expected_type[0].upper()}001',
                message=f'{expected_type.capitalize()} name `{name}` does not match convention. Suggestion: {suggestions}',
                line=line,
                column=None,
                severity='warning',
                rule='naming',
            ))
    
    def _has_docstring(self, node: ast.FunctionDef | ast.ClassDef) -> bool:
        '''Check if function/class has a docstring.'''
        
        if not node.body:
            return False
        
        first = node.body[0]
        # Check for required attributes and type before accessing nested value
        if not (isinstance(first, ast.Expr) and hasattr(first, 'value')):
            return False
        if not isinstance(first.value, (ast.Str, ast.Constant)):
            return False
        # Only access .value if it exists (Constant has it, Str may not in some AST variants)
        if not hasattr(first.value, 'value'):
            return False
        docstring_value = first.value.value
        return (
            isinstance(docstring_value, str) and
            len(docstring_value.strip()) > 0
        )
    
    def _check_regex_patterns(self, code: str) -> None:
        '''Check code against regex-based patterns.'''
        
        for pattern_name, (pattern, severity, message) in STYLE_PATTERNS.items():
            for match in re.finditer(pattern, code, re.MULTILINE):
                line_num = code[:match.start()].count('\n') + 1
                self.issues.append(StyleIssue(
                    code=pattern_name.upper(),
                    message=message,
                    line=line_num,
                    column=match.start(),
                    severity=severity,
                    rule='formatting',
                ))


def _get_naming_suggestions(name: str, expected_type: str) -> str:
    '''Get naming convention suggestions.'''
    
    if expected_type == 'class':
        return name.title().replace('_', '')
    
    if expected_type == 'function':
        return name.lower().replace('-', '_')
    
    if expected_type == 'constant':
        return name.upper().replace('-', '_')
    
    return name


def run_ruff_check(code: str, timeout: int = 30) -> Optional[list[StyleIssue]]:
    '''
    Run Ruff linter on code (if available).
    
    Returns:
        List of StyleIssue objects, or None if Ruff not available
    '''
    temp_path = None
    try:
        import tempfile
        import json
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        result = subprocess.run(
            ['ruff', 'check', '--output-format', 'json', temp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        import os
        os.unlink(temp_path)
        temp_path = None  # Mark as cleaned up
        
        if result.stdout:
            try:
                issues = json.loads(result.stdout)
                return [_parse_ruff_issue(i) for i in issues]
            except json.JSONDecodeError:
                pass
        
        return None
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    finally:
        # Ensure temp file is always cleaned up, even on exception
        if temp_path:
            try:
                import os
                os.unlink(temp_path)
            except:
                pass


def run_flake8_check(code: str, timeout: int = 30) -> Optional[list[StyleIssue]]:
    '''
    Run Flake8 linter on code (if available).
    
    Returns:
        List of StyleIssue objects, or None if Flake8 not available
    '''
    temp_path = None
    try:
        import tempfile
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        result = subprocess.run(
            ['flake8', '--format', 'json', temp_path],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        import os
        os.unlink(temp_path)
        temp_path = None  # Mark as cleaned up
        
        if result.stdout:
            try:
                import json
                issues = json.loads(result.stdout)
                return [_parse_flake8_issue(i) for i in issues]
            except json.JSONDecodeError:
                pass
        
        return None
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None
    finally:
        # Ensure temp file is always cleaned up, even on exception
        if temp_path:
            try:
                import os
                os.unlink(temp_path)
            except:
                pass


def _parse_ruff_issue(issue: dict) -> StyleIssue:
    '''Parse Ruff issue JSON into StyleIssue.'''
    
    return StyleIssue(
        code=issue.get('code', 'UNKNOWN'),
        message=issue.get('message', ''),
        line=issue.get('location', {}).get('row', 1),
        column=issue.get('location', {}).get('column'),
        severity=_map_ruff_severity(issue.get('severity', 'warning')),
        rule=issue.get('code', 'UNKNOWN')[:2].lower(),
    )


def _parse_flake8_issue(issue: dict) -> StyleIssue:
    '''Parse Flake8 issue JSON into StyleIssue.'''
    
    return StyleIssue(
        code=issue.get('code', 'UNKNOWN'),
        message=issue.get('text', ''),
        line=issue.get('line_number', 1),
        column=issue.get('column', 0),
        severity='warning',
        rule=issue.get('code', 'UNKNOWN')[:2].lower(),
    )


def _map_ruff_severity(severity: str) -> str:
    '''Map Ruff severity to our severity levels.'''
    
    mapping = {
        'error': 'error',
        'warning': 'warning',
        'information': 'info',
    }
    return mapping.get(severity.lower(), 'warning')


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    '''
    Verify that generated code follows style guidelines.
    
    Args:
        sample: EvaluationSample with:
            - raw_question: Description of the coding task
            - correct_answer: Style requirements
            - response: Agent's code
            - trajectory: Full agent trajectory
        timeout_score: Score when verification times out
        **kwargs: May include 'llm' for LLM-based judgment
    
    Returns:
        dict: {'reward': 0.0-1.0, 'reasoning': str, 'style': StyleResult}
    '''
    
    if not sample.response:
        return {'reward': 0.0, 'reasoning': 'No code generated'}
    
    code = sample.response
    
    # Parse style requirements
    strict_mode = 'strict' in (sample.correct_answer or '').lower()
    
    # Run primary analysis
    analyzer = StyleAnalyzer()
    result = analyzer.analyze(code)
    
    # Try external linters
    ruff_issues = run_ruff_check(code)
    if ruff_issues:
        result.issues.extend(ruff_issues)
    
    flake8_issues = run_flake8_check(code)
    if flake8_issues:
        result.issues.extend(flake8_issues)
    
    # Deduplicate issues from multiple sources
    seen = set()
    unique_issues = []
    for issue in result.issues:
        key = (issue.code, issue.line, issue.message)
        if key not in seen:
            seen.add(key)
            unique_issues.append(issue)
    result.issues = unique_issues
    
    # Calculate reward
    error_penalty = result.error_count * 0.15 if strict_mode else result.error_count * 0.1
    warning_penalty = result.warning_count * 0.05
    
    reward = max(0.0, 1.0 - error_penalty - warning_penalty)
    
    # Generate reasoning
    if result.error_count == 0 and result.warning_count == 0:
        reasoning = f'✓ Code follows style guidelines ({result.line_count} lines, {result.docstring_count} docstrings)'
    elif result.error_count == 0:
        reasoning = f'⚠ {result.warning_count} style warnings found'
    else:
        reasoning = f'✗ {result.error_count} style errors, {result.warning_count} warnings'
    
    return {
        'reward': reward,
        'reasoning': reasoning,
        'style': {
            'error_count': result.error_count,
            'warning_count': result.warning_count,
            'line_count': result.line_count,
            'docstring_count': result.docstring_count,
            'max_line_length': result.max_line_length,
            'issues': [
                {'code': i.code, 'message': i.message, 'line': i.line, 'severity': i.severity}
                for i in result.issues[:20]  # Limit to first 20 issues
            ],
        },
    }


def llm_based_style_check(sample: EvaluationSample, llm) -> dict:
    '''LLM-based style assessment as fallback.'''
    
    prompt = f'''Assess the code style and conventions.

Task: {sample.raw_question}
Code:
{sample.response[:2000]}

Check for:
1. Consistent naming conventions (snake_case for functions, CamelCase for classes)
2. Proper docstrings and comments
3. Clean formatting (proper spacing, alignment)
4. Logical organization of code
5. Following Python idioms (idiomatic Python vs. ported from other languages)

Score 0-1:
- 1.0: Excellent style, follows conventions, well-documented
- 0.5: Good style with minor issues
- 0.0: Poor style, inconsistent conventions, hard to read

Respond with just the number and a one-line reason.'''
    
    try:
        import asyncio
        
        # Check if event loop is already running
        try:
            loop = asyncio.get_running_loop()
            # Event loop is already running - we can't use run_until_complete
            # Fall back to default score
            pass
        except RuntimeError:
            # No event loop is running, safe to use run_until_complete
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
                    'reasoning': f'LLM style check: {result[:100]}',
                }
    except Exception:
        pass
    
    return {'reward': 0.5, 'reasoning': 'Style check unavailable'}