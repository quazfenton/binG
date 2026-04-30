#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# Documentation Verifier
# =============================================================================
# Verifies that generated code has adequate documentation.
# Checks for docstrings, comments, type hints, and README coverage.
#
# Part of the Diversify Verifiers recommendation from agent-practice-review.md.

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Optional

from .db import EvaluationSample


@dataclass
class DocumentationResult:
    module_docstring: bool
    class_docstrings: int
    function_docstrings: int
    type_hint_coverage: float  # 0.0 - 1.0
    comment_lines: int
    total_lines: int
    issues: list[str]


class DocumentationAnalyzer(ast.NodeVisitor):
    '''AST-based documentation analyzer for Python code.'''
    
    def __init__(self, tree: ast.AST):
        self.tree = tree
        self.module_docstring: bool = False
        self.class_docstrings: int = 0
        self.function_docstrings: int = 0
        self.type_hint_count: int = 0
        self.total_type_hints: int = 0
        self.comment_lines: int = 0
        self.total_lines: int = 0
        
        # Items without type hints
        self.untyped_functions: int = 0
        self.untyped_parameters: int = 0
        self._class_count: int = 0
        self._current_class: Optional[str] = None
    
    def analyze(self, code: str) -> DocumentationResult:
        '''Run full documentation analysis.'''
        
        self.total_lines = len(code.split('\n'))
        
        # Count comment lines
        for line in code.split('\n'):
            stripped = line.strip()
            if stripped.startswith('#'):
                self.comment_lines += 1
            elif stripped.startswith('\"\"\"') or stripped.startswith('r\"\"\"'):
                self.comment_lines += 1  # Docstrings count as documentation
        
        # Parse AST
        try:
            tree = ast.parse(code)
            self._check_module_docstring(tree)
            self.visit(tree)
        except SyntaxError:
            pass
        
        # Calculate type hint coverage
        type_hint_coverage = 0.0
        if self.total_type_hints > 0:
            type_hint_coverage = self.type_hint_count / self.total_type_hints
        
        # Generate issues
        issues = []
        
        if not self.module_docstring:
            issues.append('Module missing docstring')
        
        if self.class_docstrings == 0 and self._class_count > 0:
            issues.append('No class docstrings found')
        
        if self.function_docstrings == 0:
            issues.append('No function docstrings found')
        
        if type_hint_coverage < 0.5:
            issues.append(f'Low type hint coverage: {type_hint_coverage:.0%}')
        
        if self.untyped_functions > 3:
            issues.append(f'{self.untyped_functions} functions without type hints')
        
        return DocumentationResult(
            module_docstring=self.module_docstring,
            class_docstrings=self.class_docstrings,
            function_docstrings=self.function_docstrings,
            type_hint_coverage=type_hint_coverage,
            comment_lines=self.comment_lines,
            total_lines=self.total_lines,
            issues=issues,
        )
    
    def visit_Module(self, node: ast.Module) -> None:
        '''Check for module-level docstring.'''
        if node.body and isinstance(node.body[0], ast.Expr):
            first = node.body[0].value
            if isinstance(first, (ast.Str, ast.Constant)) and isinstance(first.value, str):
                if len(first.value.strip()) > 10:
                    self.module_docstring = True
        self.generic_visit(node)
    
    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        '''Check class docstring.'''
        self._class_count += 1
        self._current_class = node.name
        if self._has_docstring(node.body):
            self.class_docstrings += 1
        self.generic_visit(node)
    
    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        '''Check function docstring and type hints.'''
        # Count docstrings
        if self._has_docstring(node.body):
            self.function_docstrings += 1
        
        # Check return type hint
        if node.returns is not None:
            self.type_hint_count += 1
        self.total_type_hints += 1
        
        if node.returns is None and not node.name.startswith('_'):
            self.untyped_functions += 1
        
        # Check parameter type hints
        for arg in node.args.args:
            if arg.annotation is not None:
                self.type_hint_count += 1
            self.total_type_hints += 1
            
            if arg.annotation is None and arg.arg != 'self' and arg.arg != 'cls':
                self.untyped_parameters += 1
        
        self.generic_visit(node)
    
    visit_AsyncFunctionDef = visit_FunctionDef
    
    def _has_docstring(self, body: list) -> bool:
        '''Check if body has a docstring.'''
        if not body or not isinstance(body[0], ast.Expr):
            return False
        first = body[0].value
        return (
            isinstance(first, (ast.Str, ast.Constant)) and
            isinstance(first.value, str) and
            len(first.value.strip()) > 0
        )
    
    def _count_classes(self) -> int:
        '''Count classes in the module.'''
        return self._class_count


def analyze_documentation(code: str) -> DocumentationResult:
    '''Analyze code documentation quality.'''
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return DocumentationResult(
            module_docstring=False,
            class_docstrings=0,
            function_docstrings=0,
            type_hint_coverage=0.0,
            comment_lines=0,
            total_lines=code.count('\n') + 1,
            issues=['Syntax error: could not parse code'],
        )
    
    analyzer = DocumentationAnalyzer(tree)
    return analyzer.analyze(code)


def check_readme(code: str, readme_text: Optional[str] = None) -> dict:
    '''
    Check if code is documented in a README.
    
    Args:
        code: Python source code
        readme_text: README content (if available)
    
    Returns:
        dict with README coverage metrics
    '''
    if not readme_text:
        return {
            'has_readme': False,
            'coverage_score': 0.0,
            'sections_found': [],
            'missing_sections': ['installation', 'usage', 'api'],
        }
    
    # Extract function/class names from code
    try:
        tree = ast.parse(code)
        public_items = []
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
                if not node.name.startswith('_'):
                    public_items.append(node.name)
    except SyntaxError:
        public_items = []
    
    # Check README sections
    sections_found = []
    readme_lower = readme_text.lower()
    
    required_sections = {
        'installation': ['install', 'pip install', 'setup', 'requirements'],
        'usage': ['usage', 'example', 'quick start', 'how to'],
        'api': ['api', 'reference', 'functions', 'classes'],
        'contributing': ['contribute', 'license', 'author'],
    }
    
    for section, keywords in required_sections.items():
        if any(kw in readme_lower for kw in keywords):
            sections_found.append(section)
    
    # Check coverage of public items
    documented_items = []
    for item in public_items:
        if item.lower() in readme_lower:
            documented_items.append(item)
    
    coverage_score = len(documented_items) / max(len(public_items), 1)
    
    return {
        'has_readme': True,
        'coverage_score': coverage_score,
        'sections_found': sections_found,
        'missing_sections': [s for s in required_sections if s not in sections_found],
        'documented_items': documented_items,
        'total_public_items': len(public_items),
    }


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    '''
    Verify that generated code has adequate documentation.
    
    Args:
        sample: EvaluationSample with:
            - raw_question: Description of the coding task
            - correct_answer: Documentation requirements
            - response: Agent's code
            - trajectory: Full agent trajectory
            - metadata.readme: README content (if available)
        timeout_score: Score when verification times out
        **kwargs: May include 'llm' for LLM-based judgment
    
    Returns:
        dict: {'reward': 0.0-1.0, 'reasoning': str, 'documentation': DocumentationResult}
    '''
    
    if not sample.response:
        return {'reward': 0.0, 'reasoning': 'No code generated'}
    
    code = sample.response
    
    # Parse documentation requirements
    requirements = _parse_doc_requirements(sample.correct_answer or '')
    
    # Analyze code documentation
    result = analyze_documentation(code)
    
    # Check README if available
    readme_text = sample.metadata.get('readme') if sample.metadata else None
    readme_result = check_readme(code, readme_text)
    
    # Calculate reward
    reward = 1.0
    
    # Module docstring check
    if requirements.get('require_module_docstring', False):
        if not result.module_docstring:
            reward *= 0.7
    
    # Type hint coverage
    min_hint_coverage = requirements.get('min_type_hint_coverage', 0.5)
    if result.type_hint_coverage < min_hint_coverage:
        reward *= 0.8
    
    # Docstring count
    min_docstrings = requirements.get('min_function_docstrings', 1)
    if result.function_docstrings < min_docstrings:
        reward *= 0.7
    
    # README coverage
    if readme_result.get('has_readme'):
        readme_coverage = readme_result.get('coverage_score', 0)
        if readme_coverage < 0.5:
            reward *= 0.9
    
    # Generate reasoning
    issues = result.issues[:3]  # Show first 3 issues
    if not issues and not readme_result.get('missing_sections'):
        reasoning = f'✓ Well-documented: {result.function_docstrings} functions with docstrings, {result.type_hint_coverage:.0%} type hints'
    else:
        reasoning = msg = issues[0] if issues else 'incomplete docs'
        reasoning = f'⚠ Documentation gaps: {msg}'
    
    return {
        'reward': max(0.0, reward),
        'reasoning': reasoning,
        'documentation': {
            'module_docstring': result.module_docstring,
            'class_docstrings': result.class_docstrings,
            'function_docstrings': result.function_docstrings,
            'type_hint_coverage': result.type_hint_coverage,
            'comment_lines': result.comment_lines,
            'total_lines': result.total_lines,
            'issues': result.issues,
            'readme': readme_result,
        },
    }


def _parse_doc_requirements(text: str) -> dict:
    '''Parse documentation requirements from text.'''
    
    requirements = {
        'require_module_docstring': 'module' in text.lower(),
        'min_function_docstrings': 1,
        'min_type_hint_coverage': 0.5,
    }
    
    text_lower = text.lower()
    
    # Parse type hint requirements
    hint_match = re.search(r'(?:type\\s+hint|typing)[\\s:]*(?:\\d+%)?', text_lower)
    if hint_match:
        percent_match = re.search(r'(\\d+)%', text)
        if percent_match:
            requirements['min_type_hint_coverage'] = int(percent_match.group(1)) / 100
    
    # Parse docstring requirements
    doc_match = re.search(r'(?:docstring|docs?)[\\s:]*(?:at\\s+least\\s+)?(\\d+)', text_lower)
    if doc_match:
        requirements['min_function_docstrings'] = int(doc_match.group(1))
    
    # Check for strict requirements
    if 'complete' in text_lower or 'thorough' in text_lower:
        requirements['min_type_hint_coverage'] = 0.8
        requirements['require_module_docstring'] = True
    
    return requirements


def llm_based_documentation_check(sample: EvaluationSample, llm) -> dict:
    '''LLM-based documentation assessment as fallback.'''
    
    prompt = f'''Assess the documentation quality of this code.

Task: {sample.raw_question}
Code:
{sample.response[:3000]}

Check for:
1. Clear docstrings explaining purpose and parameters
2. Adequate comments for complex logic
3. Type hints for function signatures
4. Module-level docstring explaining the file's purpose
5. Usage examples or inline documentation

Score 0-1:
- 1.0: Excellent documentation, self-explanatory code
- 0.5: Adequate documentation but room for improvement
- 0.0: Poor documentation, code is hard to understand

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
                'reasoning': f'LLM documentation check: {result[:100]}',
            }
    except Exception:
        pass
    
    return {'reward': 0.5, 'reasoning': 'Documentation check unavailable'}


def generate_docstring(function_name: str, parameters: list[str], return_type: Optional[str] = None) -> str:
    '''
    Generate a basic docstring template for a function.
    
    Args:
        function_name: Name of the function
        parameters: List of parameter names
        return_type: Expected return type annotation
    
    Returns:
        docstring template as string
    '''
    params_str = ', '.join(parameters) if parameters else '...'
    
    docstring = f'''\"\"\"
    Brief description of {function_name}.

    Args:
        {params_str}

    Returns:
        {return_type or 'None'}: Description of return value.
    \"\"\"'''
    
    return docstring