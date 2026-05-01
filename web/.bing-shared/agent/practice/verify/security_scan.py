#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# =============================================================================
# Security Scan Verifier
# =============================================================================
# Verifies that generated code passes common security checks.
# Checks for OWASP Top 10 vulnerabilities and common security anti-patterns.
#
# Part of the Diversify Verifiers recommendation from agent-practice-review.md.

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Optional

from .db import EvaluationSample


# Security vulnerability patterns (regex-based)
VULNERABILITY_PATTERNS = {
    # SQL Injection
    'sql_injection': [
        r'execute\\s*\\s*\bSELECT\b.*%\b',  # f-string in SQL
        r'cursor\\.execute\f?.*{',  # format string in SQL
        r'psycopg2.*%s.*SELECT',  # % formatting in SQL
    ],
    # Command Injection
    'command_injection': [
        r'os\\.system\\s*\\(',  # os.system with user input
        r'subprocess\\.call\\s*\\(',  # subprocess.call
        r'subprocess\\.run\\s*\\(',  # subprocess.run
        r'eval\\s*\\(',  # eval usage
        r'exec\\s*\\(',  # exec usage
    ],
    # Path Traversal
    'path_traversal': [
        r'open\\s*\\([^)]*\\+',  # path concatenation
        r'open\\s*\\([^)]*f\\.format',  # f-string in file path
        r'pathlib\\..*\\+',  # pathlib with concatenation
        r'os\\.path\\.join.*\\.\\.\\/',  # potential .. traversal
    ],
    # XSS (cross-site scripting)
    'xss': [
        r'innerHTML\\s*=',  # direct HTML injection
        r'dangerouslySetInnerHTML',  # React XSS
        r'document\\.write\\(',  # document.write
        r'\\.html\\(\\s*[^,]+[^,}]',  # jQuery html() with user input
    ],
    # Hardcoded secrets
    'hardcoded_secrets': [
        r'api[_-]?key\\s*=\\s*[\"\\'][a-zA-Z0-9]{20,}',  # API key
        r'secret\\s*=\\s*[\"\\'][a-zA-Z0-9]{20,}',  # Secret
        r'password\\s*=\\s*[\"\\'][^\"\\']{8,}',  # Password
        r'private[_-]?key\\s*=\\s*[\"\\']-----BEGIN',  # SSH key
    ],
    # Weak crypto
    'weak_crypto': [
        r'md5\\s*\\(',  # MD5 hash
        r'sha1\\s*\\(',  # SHA1 hash
        r'hashlib\\.md5\\(',  # hashlib md5
        r'hashlib\\.sha1\\(',  # hashlib sha1
        r'random\\.randint.*secret',  # random for secrets
    ],
    # Insecure dependencies
    'insecure_deps': [
        r'import\\s+jinja2',  # Jinja2 (may have vulnerabilities if misconfigured)
    ],
}


def verify_func(sample: EvaluationSample, timeout_score: float = 0, **kwargs) -> dict:
    '''
    Verify that generated code is free from common security vulnerabilities.
    
    Args:
        sample: EvaluationSample with:
            - raw_question: Description of the coding task
            - correct_answer: Security requirements
            - response: Agent's code
            - trajectory: Full agent trajectory
        timeout_score: Score when verification times out
        **kwargs: May include 'llm' for LLM-based judgment
    
    Returns:
        dict: {'reward': 0.0-1.0, 'reasoning': str, 'vulnerabilities': list}
    '''
    
    if not sample.response:
        return {'reward': 0.0, 'reasoning': 'No code generated'}
    
    code = sample.response
    
    # Find vulnerabilities
    findings = []
    for vuln_type, patterns in VULNERABILITY_PATTERNS.items():
        for pattern in patterns:
            matches = list(re.finditer(pattern, code, re.IGNORECASE))
            if matches:
                for match in matches:
                    # Get context around the match
                    start = max(0, match.start() - 50)
                    end = min(len(code), match.end() + 50)
                    context = code[start:end].replace('\n', ' ').strip()
                    
                    findings.append({
                        'type': vuln_type,
                        'severity': _get_severity(vuln_type),
                        'match': match.group(0),
                        'context': f'...{context}...',
                    })
    
    if not findings:
        return {
            'reward': 1.0,
            'reasoning': '✓ No security vulnerabilities detected',
            'vulnerabilities': [],
        }
    
    # Calculate reward based on severity and count
    severity_weights = {'critical': 0.2, 'high': 0.3, 'medium': 0.5, 'low': 0.8}
    
    total_penalty = 0
    reasoning_parts = []
    
    for finding in findings:
        penalty = severity_weights.get(finding['severity'], 0.5)
        total_penalty += penalty
        reasoning_parts.append(f'{finding[\"type\"]}({finding[\"severity\"]})')
    
    # Deduct from base score
    reward = max(0.0, 1.0 - total_penalty)
    
    # Check for known security requirements
    if sample.correct_answer:
        requirements = sample.correct_answer.lower()
        
        # If code is expected to handle secrets but has hardcoded secrets
        if 'secret' in requirements and any(f['type'] == 'hardcoded_secrets' for f in findings):
            reward *= 0.5
            
        # If code is expected to be SQL-safe but has SQL injection
        if 'sql' in requirements and any(f['type'] == 'sql_injection' for f in findings):
            reward *= 0.3
    
    return {
        'reward': reward,
        'reasoning': f'⚠ Found {len(findings)} security issues: {\"; \".join(reasoning_parts[:5])}',
        'vulnerabilities': findings,
    }


def _get_severity(vuln_type: str) -> str:
    '''Get severity level for vulnerability type'''
    
    severity_map = {
        'sql_injection': 'critical',
        'command_injection': 'critical',
        'hardcoded_secrets': 'high',
        'path_traversal': 'high',
        'xss': 'high',
        'weak_crypto': 'medium',
        'insecure_deps': 'medium',
    }
    
    return severity_map.get(vuln_type, 'medium')


def scan_with_bandit(code: str, timeout: int = 30) -> Optional[dict]:
    '''
    Run Bandit security scanner on code.
    
    Args:
        code: Python code to scan
        timeout: Scan timeout in seconds
    
    Returns:
        dict with scan results, or None if Bandit is not available
    '''
    try:
        # Write code to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        # Run Bandit
        result = subprocess.run(
            ['bandit', '-r', temp_path, '-f', 'json'],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        # Clean up
        Path(temp_path).unlink(missing_ok=True)
        
        if result.returncode != 0:
            try:
                return {'results': result.stdout, 'error': None}
            except Exception:
                return None
        
        import json
        report = json.loads(result.stdout)
        
        return {
            'results': report.get('results', []),
            'metrics': report.get('metrics', {}),
            'error': None,
        }
        
    except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
        return None


def scan_with_semgrep(code: str, pattern: str, timeout: int = 30) -> Optional[dict]:
    '''
    Run Semgrep security scan on code.
    
    Args:
        code: Code to scan
        pattern: Semgrep pattern to use
        timeout: Scan timeout
    
    Returns:
        dict with scan results
    '''
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        result = subprocess.run(
            ['semgrep', '--config', 'r/python.lang.security', temp_path, '--json'],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        
        Path(temp_path).unlink(missing_ok=True)
        
        if result.returncode == 0:
            import json
            return {'results': json.loads(result.stdout), 'error': None}
        
        return {'results': [], 'error': None}
        
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def llm_based_security_check(sample: EvaluationSample, llm) -> dict:
    '''
    LLM-based security check as fallback or additional verification.
    
    Checks for security issues that regex patterns might miss:
    - Logic flaws
    - Race conditions
    - Authentication bypass
    - Authorization issues
    '''
    
    prompt = f'''Analyze this code for security vulnerabilities.

Task: {sample.raw_question}
Code:
{sample.response[:3000]}

Check specifically for:
1. Authentication/authorization bypasses
2. Race conditions or TOCTOU issues
3. Information disclosure
4. Business logic vulnerabilities
5. Deserialization issues
6. XML External Entity (XXE)
7. Deserialization of untrusted data

Score 0-1:
- 1.0: No security issues found
- 0.5: Minor issues or areas of concern
- 0.0: Critical security vulnerabilities present

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
                'reasoning': f'LLM security check: {result[:100]}',
            }
    except Exception:
        pass
    
    return {
        'reward': 0.5,
        'reasoning': 'LLM security check unavailable',
    }