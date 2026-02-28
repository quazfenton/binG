import { describe, it, expect, vi } from 'vitest';
import {
  verifyChanges,
  quickSyntaxCheck,
  type VerificationOptions,
} from '@/lib/stateful-agent/agents/verification';

describe('Verification System', () => {
  describe('verifyChanges', () => {
    it('should pass for empty files object', async () => {
      const result = await verifyChanges({});

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass for valid TypeScript', async () => {
      const files = {
        '/test.ts': 'const x: number = 1;\nexport { x };',
      };

      const result = await verifyChanges(files);

      expect(result.passed).toBe(true);
    });

    it('should detect unbalanced braces', async () => {
      const files = {
        '/test.ts': 'function test() {', // Missing closing brace
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('Unbalanced'))).toBe(true);
    });

    it('should detect unbalanced parentheses', async () => {
      const files = {
        '/test.ts': 'const x = (1 + 2;', // Missing closing paren
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('parentheses'))).toBe(true);
    });

    it('should detect unbalanced brackets', async () => {
      const files = {
        '/test.ts': 'const arr = [1, 2, 3;', // Missing closing bracket
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('brackets'))).toBe(true);
    });

    it('should pass for valid JSON', async () => {
      const files = {
        '/test.json': '{"name": "test", "value": 123}',
      };

      const result = await verifyChanges(files);

      expect(result.passed).toBe(true);
    });

    it('should detect invalid JSON', async () => {
      const files = {
        '/test.json': '{"name": "test",}', // Trailing comma
      };

      const result = await verifyChanges(files);

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].error).toContain('Invalid JSON');
    });

    it('should detect invalid JSON syntax', async () => {
      const files = {
        '/test.json': '{invalid json}',
      };

      const result = await verifyChanges(files);

      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn for console statements in strict mode', async () => {
      const files = {
        '/test.ts': 'console.log("debug");\nconst x = 1;',
      };

      const result = await verifyChanges(files, { strict: true });

      expect(result.warnings.some(w => w.error.includes('Console'))).toBe(true);
    });

    it('should warn for TODO comments', async () => {
      const files = {
        '/test.ts': '// TODO: fix this later\nconst x = 1;',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('TODO'))).toBe(true);
    });

    it('should warn for FIXME comments', async () => {
      const files = {
        '/test.ts': '// FIXME: broken code\nconst x = 1;',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('FIXME'))).toBe(true);
    });

    it('should warn for long lines', async () => {
      const files = {
        '/test.ts': `const veryLongLine = '${'x'.repeat(160)}';`,
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('150 characters'))).toBe(true);
    });

    it('should handle multiple files', async () => {
      const files = {
        '/test1.ts': 'const x = 1;',
        '/test2.ts': 'const y = 2;',
        '/test3.json': '{"z": 3}',
      };

      const result = await verifyChanges(files);

      expect(result.passed).toBe(true);
    });

    it('should stop at max errors', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 20; i++) {
        files[`/invalid${i}.json`] = '{invalid';
      }

      const result = await verifyChanges(files, { maxErrors: 5 });

      expect(result.errors.length).toBeLessThanOrEqual(5);
    });

    it('should respect timeout', async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        files[`/file${i}.ts`] = 'const x = 1;';
      }

      const startTime = Date.now();
      const result = await verifyChanges(files, { timeoutMs: 100 });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500); // Should timeout quickly
    });

    it('should generate reprompt on errors', async () => {
      const files = {
        '/test.json': '{invalid}',
      };

      const result = await verifyChanges(files);

      expect(result.reprompt).toBeDefined();
      expect(result.reprompt).toContain('error');
      expect(result.reprompt).toContain('fix');
    });

    it('should not generate reprompt when passed', async () => {
      const files = {
        '/test.ts': 'const x = 1;',
      };

      const result = await verifyChanges(files);

      expect(result.reprompt).toBeUndefined();
    });

    it('should handle YAML files', async () => {
      const files = {
        '/test.yaml': 'name: test\nvalue: 123',
      };

      const result = await verifyChanges(files);

      // Should not throw, may warn about missing js-yaml
      expect(result).toBeDefined();
    });

    it('should handle invalid YAML', async () => {
      const files = {
        '/test.yaml': 'invalid: yaml: content:',
      };

      const result = await verifyChanges(files);

      // Should detect as error or pass through
      expect(result).toBeDefined();
    });

    it('should handle HTML files', async () => {
      const files = {
        '/test.html': '<div><p>Hello</p></div>',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
    });

    it('should warn for unclosed HTML tags', async () => {
      const files = {
        '/test.html': '<div><p>Unclosed',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('Unclosed'))).toBe(true);
    });

    it('should handle CSS files', async () => {
      const files = {
        '/test.css': '.class { color: red; }',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
    });

    it('should detect unbalanced CSS braces', async () => {
      const files = {
        '/test.css': '.class { color: red;', // Missing closing brace
      };

      const result = await verifyChanges(files);

      expect(result.errors.some(e => e.error.includes('Unbalanced'))).toBe(true);
    });

    it('should handle Python files', async () => {
      const files = {
        '/test.py': 'def hello():\n    print("Hello")',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
    });

    it('should warn for tabs in Python', async () => {
      const files = {
        '/test.py': 'def hello():\n\tprint("tab")', // Tab character
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('Tab'))).toBe(true);
    });

    it('should handle shell scripts', async () => {
      const files = {
        '/test.sh': '#!/bin/bash\necho "Hello"',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
    });

    it('should warn for unclosed quotes in shell', async () => {
      const files = {
        '/test.sh': 'echo "unclosed',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('quote'))).toBe(true);
    });

    it('should handle Markdown files', async () => {
      const files = {
        '/test.md': '# Heading\n\nContent here.',
      };

      const result = await verifyChanges(files);

      expect(result).toBeDefined();
    });

    it('should warn for very long Markdown lines', async () => {
      const files = {
        '/test.md': `# Heading\n\n${'x'.repeat(250)}`,
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('long line'))).toBe(true);
    });

    it('should warn for bare URLs in Markdown', async () => {
      const files = {
        '/test.md': 'Check out https://example.com for more info',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('Bare URL'))).toBe(true);
    });

    it('should handle unknown file types', async () => {
      const files = {
        '/test.unknown': 'some content',
      };

      const result = await verifyChanges(files);

      // Should do basic structural checks
      expect(result).toBeDefined();
    });

    it('should warn for empty files', async () => {
      const files = {
        '/test.ts': '',
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('empty'))).toBe(true);
    });

    it('should warn for very large files', async () => {
      const files = {
        '/test.ts': 'x'.repeat(1000001), // > 1MB
      };

      const result = await verifyChanges(files);

      expect(result.warnings.some(w => w.error.includes('large file'))).toBe(true);
    });

    it('should handle files with special characters in path', async () => {
      const files = {
        '/src/test file.ts': 'const x = 1;',
        '/src/文件.ts': 'const y = 2;',
      };

      const result = await verifyChanges(files);

      expect(result.passed).toBe(true);
    });
  });

  describe('quickSyntaxCheck', () => {
    it('should return valid for good TypeScript', async () => {
      const result = await quickSyntaxCheck('/test.ts', 'const x: number = 1;');

      expect(result.valid).toBe(true);
    });

    it('should return invalid for bad JSON', async () => {
      const result = await quickSyntaxCheck('/test.json', '{invalid}');

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return valid for good JSON', async () => {
      const result = await quickSyntaxCheck('/test.json', '{"valid": true}');

      expect(result.valid).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const result = await quickSyntaxCheck('/test.ts', 'invalid syntax here {{{');

      // Should not throw, should return error info
      expect(result).toBeDefined();
    });
  });

  describe('VerificationOptions', () => {
    it('should respect strict mode', async () => {
      const files = {
        '/test.ts': 'console.log("test");',
      };

      const strictResult = await verifyChanges(files, { strict: true });
      const lenientResult = await verifyChanges(files, { strict: false });

      // Strict mode should have more warnings
      expect(strictResult.warnings.length).toBeGreaterThanOrEqual(lenientResult.warnings.length);
    });

    it('should handle custom language override', async () => {
      const files = {
        '/test.noext': 'const x: number = 1;',
      };

      const result = await verifyChanges(files, { language: 'typescript' });

      expect(result).toBeDefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle null/undefined content', async () => {
      const files = {
        '/test.ts': null as any,
      };

      const result = await verifyChanges(files);
      expect(result).toBeDefined();
    });

    it('should handle very small timeout', async () => {
      const files = {
        '/test1.ts': 'const x = 1;',
        '/test2.ts': 'const y = 2;',
      };

      const result = await verifyChanges(files, { timeoutMs: 1 });
      expect(result).toBeDefined();
    });

    it('should handle maxErrors of 0', async () => {
      const files = {
        '/test.json': '{invalid}',
      };

      const result = await verifyChanges(files, { maxErrors: 0 });
      // Should return immediately
      expect(result.errors.length).toBe(0);
    });

    it('should handle concurrent verifications', async () => {
      const files1 = { '/test1.ts': 'const x = 1;' };
      const files2 = { '/test2.ts': 'const y = 2;' };
      const files3 = { '/test3.json': '{"z": 3}' };

      const results = await Promise.all([
        verifyChanges(files1),
        verifyChanges(files2),
        verifyChanges(files3),
      ]);

      expect(results).toHaveLength(3);
      results.forEach(r => expect(r.passed).toBe(true));
    });
  });

  describe('Error message quality', () => {
    it('should provide helpful error messages for JSON', async () => {
      const files = {
        '/test.json': '{"name": "test",}',
      };

      const result = await verifyChanges(files);

      expect(result.errors[0].error).toContain('JSON');
    });

    it('should include line numbers when possible', async () => {
      const files = {
        '/test.json': '{\n  "valid": true,\n  "invalid":,\n  "another": "value"\n}',
      };

      const result = await verifyChanges(files);

      expect(result.errors[0].line).toBeGreaterThan(0);
    });

    it('should include file path in errors', async () => {
      const files = {
        '/src/test.json': '{invalid}',
      };

      const result = await verifyChanges(files);

      expect(result.errors[0].path).toBe('/src/test.json');
    });
  });
});
