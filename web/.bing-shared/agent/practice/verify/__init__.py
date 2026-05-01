"""Verification functions for practice module.

Available verifiers:
- math: Mathematical problem verification (math_verify or string fallback)
- vfs_tool_use: VFS MCP tool usage verification
- code_coverage: Test coverage verification (supports pytest-cov, Jest)
- security_scan: Security vulnerability scanning (OWASP Top 10 patterns)
- complexity: Cyclomatic complexity, function length, nesting depth analysis
- style: PEP8, naming conventions, formatting checks (Ruff, Flake8)
- documentation: Docstrings, type hints, README coverage analysis
"""

from .math import verify_func as math_verify
from .vfs_tool_use import verify_func as vfs_tool_verify
from .code_coverage import verify_func as code_coverage_verify
from .security_scan import verify_func as security_scan_verify
from .complexity import verify_func as complexity_verify
from .style import verify_func as style_verify
from .documentation import verify_func as documentation_verify

__all__ = [
    'math_verify',
    'vfs_tool_verify',
    'code_coverage_verify',
    'security_scan_verify',
    'complexity_verify',
    'style_verify',
    'documentation_verify',
]
