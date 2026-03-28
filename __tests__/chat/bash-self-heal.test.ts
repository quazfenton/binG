/**
 * Bash Self-Healing Tests
 * 
 * Tests for automatic error recovery in bash command execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  classifyError,
  generateFix,
  repairWithLLM,
  isSafe,
  isMinimalChange,
  executeWithHealing,
  type BashFailure,
} from '@/lib/chat/bash-self-heal';

describe('Bash Self-Healing', () => {
  describe('classifyError', () => {
    it('should classify command not found', () => {
      expect(classifyError('command not found: jqq')).toBe('command_not_found');
      expect(classifyError('jqq: command not found')).toBe('command_not_found');
    });

    it('should classify file not found', () => {
      expect(classifyError('No such file or directory: data.json')).toBe('file_not_found');
      expect(classifyError('file not found: /workspace/test.txt')).toBe('file_not_found');
    });

    it('should classify permission denied', () => {
      expect(classifyError('permission denied: ./script.sh')).toBe('permission_denied');
      expect(classifyError('EACCES: permission denied')).toBe('permission_denied');
    });

    it('should classify syntax error', () => {
      expect(classifyError('syntax error near unexpected token `fi`')).toBe('syntax_error');
      expect(classifyError('parse error on line 3')).toBe('syntax_error');
    });

    it('should classify timeout', () => {
      expect(classifyError('command timed out after 30s')).toBe('timeout');
      expect(classifyError('timeout: exceeded')).toBe('timeout');
    });

    it('should classify unknown errors', () => {
      expect(classifyError('some random error')).toBe('unknown');
    });
  });

  describe('generateFix', () => {
    it('should fix command typos', () => {
      const failure: BashFailure = {
        command: 'jqq data.json',
        stderr: 'command not found: jqq',
        stdout: '',
        exitCode: 127,
        attempt: 1,
      };

      const fix = generateFix(failure, 'command_not_found');
      expect(fix).toBe('jq data.json');
    });

    it('should fix file paths', () => {
      const failure: BashFailure = {
        command: 'cat result.json',
        stderr: 'No such file or directory: result.json',
        stdout: '',
        exitCode: 1,
        attempt: 1,
      };

      const fix = generateFix(failure, 'file_not_found');
      expect(fix).toBe('cat /output/result.json');
    });

    it('should add sudo for permission denied', () => {
      const failure: BashFailure = {
        command: 'rm /var/log/test.log',
        stderr: 'permission denied: /var/log/test.log',
        stdout: '',
        exitCode: 1,
        attempt: 1,
      };

      const fix = generateFix(failure, 'permission_denied');
      expect(fix).toBe('sudo rm /var/log/test.log');
    });

    it('should return null for syntax errors (needs LLM)', () => {
      const failure: BashFailure = {
        command: 'if [ true ]; then echo yes',
        stderr: 'syntax error near unexpected token `fi`',
        stdout: '',
        exitCode: 2,
        attempt: 1,
      };

      const fix = generateFix(failure, 'syntax_error');
      expect(fix).toBeNull();
    });
  });

  describe('isSafe', () => {
    it('should reject dangerous commands', () => {
      expect(isSafe('rm -rf /')).toBe(false);
      expect(isSafe('rm -rf /*')).toBe(false);
      expect(isSafe('shutdown')).toBe(false);
      expect(isSafe('reboot')).toBe(false);
      expect(isSafe(':(){ :|:& };:')).toBe(false);  // fork bomb
      expect(isSafe('mkfs')).toBe(false);
    });

    it('should allow safe commands', () => {
      expect(isSafe('ls -la')).toBe(true);
      expect(isSafe('cat file.txt')).toBe(true);
      expect(isSafe('grep pattern file.txt')).toBe(true);
      expect(isSafe('echo hello > output.txt')).toBe(true);
    });

    it('should allow commands with sudo', () => {
      expect(isSafe('sudo apt-get update')).toBe(true);
      expect(isSafe('sudo rm /var/log/test.log')).toBe(true);
    });
  });

  describe('isMinimalChange', () => {
    it('should accept minimal changes', () => {
      expect(isMinimalChange('jqq data.json', 'jq data.json')).toBe(true);
      expect(isMinimalChange('cat file.txt', 'cat /workspace/file.txt')).toBe(true);
    });

    it('should reject large changes', () => {
      expect(isMinimalChange('cat file.txt', 'python3 script.py --arg1 --arg2 --arg3')).toBe(false);
      expect(isMinimalChange('ls', 'find / -name "*" -type f -exec cat {} \\;')).toBe(false);
    });

    it('should use custom threshold', () => {
      expect(isMinimalChange('cat file.txt', 'cat /workspace/file.txt', 0.1)).toBe(false);
      expect(isMinimalChange('cat file.txt', 'cat /workspace/file.txt', 1.0)).toBe(true);
    });
  });

  describe('executeWithHealing', () => {
    it('should succeed on first attempt', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        success: true,
        stdout: 'hello',
        stderr: '',
        exitCode: 0,
      });

      const result = await executeWithHealing(mockExecute, 'echo hello', 3);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe('hello');
      expect(result.attempts).toBe(1);
      expect(result.fixesApplied).toHaveLength(0);
    });

    it('should retry with fix on failure', async () => {
      let callCount = 0;
      const mockExecute = vi.fn().mockImplementation(async (command: string) => {
        callCount++;
        if (callCount === 1) {
          // First attempt fails
          return {
            success: false,
            stdout: '',
            stderr: 'command not found: jqq',
            exitCode: 127,
          };
        }
        // Second attempt succeeds
        return {
          success: true,
          stdout: 'data',
          stderr: '',
          exitCode: 0,
        };
      });

      const result = await executeWithHealing(mockExecute, 'jqq data.json', 3);

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.fixesApplied).toHaveLength(1);
      expect(result.fixesApplied[0].original).toBe('jqq data.json');
      expect(result.fixesApplied[0].fixed).toBe('jq data.json');
    });

    it('should stop after max attempts', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'some error',
        exitCode: 1,
      });

      const result = await executeWithHealing(mockExecute, 'bad command', 3);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('should not retry timeout errors', async () => {
      const mockExecute = vi.fn().mockResolvedValue({
        success: false,
        stdout: '',
        stderr: 'command timed out',
        exitCode: -1,
      });

      const result = await executeWithHealing(mockExecute, 'slow command', 3);

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);  // Should not retry
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('should reject unsafe fixes', async () => {
      let callCount = 0;
      const mockExecute = vi.fn().mockImplementation(async (command: string) => {
        callCount++;
        if (callCount === 1) {
          return {
            success: false,
            stdout: '',
            stderr: 'error',
            exitCode: 1,
          };
        }
        // LLM would suggest dangerous fix
        return {
          success: true,
          stdout: 'done',
          stderr: '',
          exitCode: 0,
        };
      });

      // Mock repairWithLLM to return dangerous command
      vi.mock('@/lib/chat/bash-self-heal', async (importOriginal) => {
        const original = await importOriginal() as any;
        return {
          ...original,
          repairWithLLM: vi.fn().mockResolvedValue('rm -rf /'),
        };
      });

      const result = await executeWithHealing(mockExecute, 'test', 3);

      expect(result.success).toBe(false);  // Should fail because fix was unsafe
    });
  });
});

describe('Bash Self-Healing Examples', () => {
  it('should fix common typos', async () => {
    const testCases = [
      { from: 'jqq data.json', to: 'jq data.json' },
      { from: 'grepp pattern file', to: 'grep pattern file' },
      { from: 'sedd s/a/b/g file', to: 'sed s/a/b/g file' },
      { from: 'awwk {print}', to: 'awk {print}' },
    ];

    for (const { from, to } of testCases) {
      const failure: BashFailure = {
        command: from,
        stderr: `command not found: ${from.split(' ')[0]}`,
        stdout: '',
        exitCode: 127,
        attempt: 1,
      };

      const fix = generateFix(failure, 'command_not_found');
      expect(fix).toBe(to);
    }
  });

  it('should fix common path issues', async () => {
    const testCases = [
      { from: 'cat result.json', to: 'cat /output/result.json' },
      { from: 'cat data.json', to: 'cat /workspace/data.json' },
      { from: 'cat output.txt', to: 'cat /output/output.txt' },
    ];

    for (const { from, to } of testCases) {
      const failure: BashFailure = {
        command: from,
        stderr: `No such file or directory: ${from.split(' ')[1]}`,
        stdout: '',
        exitCode: 1,
        attempt: 1,
      };

      const fix = generateFix(failure, 'file_not_found');
      expect(fix).toBe(to);
    }
  });
});
