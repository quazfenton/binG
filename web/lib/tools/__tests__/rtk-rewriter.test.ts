import { describe, it, expect } from 'vitest';
import { rewriteCommand, filterOutput, hasRewriteRule, estimateTokenSavings } from '../rtk-rewriter';

describe('RTK Rewriter', () => {
  describe('rewriteCommand', () => {
    it('should rewrite git status to short format', () => {
      expect(rewriteCommand('git status')).toBe('git status --short');
    });

    it('should not rewrite already short git status', () => {
      expect(rewriteCommand('git status --short')).toBe('git status --short');
    });

    it('should rewrite git log to oneline format', () => {
      expect(rewriteCommand('git log')).toBe('git log --oneline -20');
    });

    it('should rewrite git diff to stat format', () => {
      expect(rewriteCommand('git diff')).toBe('git diff --stat');
    });

    it('should rewrite ls -la to classified format', () => {
      expect(rewriteCommand('ls -la')).toBe('ls -F');
    });

    it('should rewrite docker ps to compact format', () => {
      expect(rewriteCommand('docker ps')).toBe('docker ps --format "{{.ID}} {{.Status}}"');
    });

    it('should rewrite kubectl get pods', () => {
      expect(rewriteCommand('kubectl get pods')).toBe('kubectl get pods -o wide');
    });

    it('should keep unknown commands unchanged', () => {
      expect(rewriteCommand('unknown command')).toBe('unknown command');
    });

    it('should handle empty command', () => {
      expect(rewriteCommand('')).toBe('');
    });

    it('should handle command with whitespace', () => {
      expect(rewriteCommand('  git status  ')).toBe('git status --short');
    });
  });

  describe('filterOutput', () => {
    it('should remove ANSI color codes', () => {
      const output = '\x1b[32mSuccess\x1b[0m\n\x1b[31mError\x1b[0m';
      const filtered = filterOutput('echo test', output);
      expect(filtered).not.toContain('\x1b[');
    });

    it('should truncate long output to maxLines', () => {
      const lines = Array.from({ length: 150 }, (_, i) => `Line ${i}`).join('\n');
      const filtered = filterOutput('echo test', lines, { maxLines: 10 });
      const lineCount = filtered.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(12); // 10 lines + truncation message
    });

    it('should truncate output to maxChars', () => {
      const output = 'x'.repeat(60000);
      const filtered = filterOutput('echo test', output, { maxChars: 1000 });
      expect(filtered.length).toBeLessThanOrEqual(1015); // 1000 + truncation message
    });

    it('should remove empty lines when enabled', () => {
      const output = 'Line 1\n\n\n\nLine 2\n\n\nLine 3';
      const filtered = filterOutput('echo test', output, { enableFilters: true });
      expect(filtered.split('\n').filter(l => l.trim()).length).toBe(3);
    });

    it('should respect enableFilters option', () => {
      const output = '\x1b[32mGreen\x1b[0m\n\n\nText';
      const filtered = filterOutput('echo test', output, { enableFilters: false });
      expect(filtered).toContain('\x1b[');
    });

    it('should return original output for null/undefined', () => {
      expect(filterOutput('cmd', '')).toBe('');
    });
  });

  describe('hasRewriteRule', () => {
    it('should return true for git status', () => {
      expect(hasRewriteRule('git status')).toBe(true);
    });

    it('should return true for docker ps', () => {
      expect(hasRewriteRule('docker ps')).toBe(true);
    });

    it('should return false for unknown command', () => {
      expect(hasRewriteRule('some random command')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(hasRewriteRule('')).toBe(false);
    });
  });

  describe('estimateTokenSavings', () => {
    it('should calculate token savings correctly', () => {
      const original = 'a'.repeat(400);
      const filtered = 'a'.repeat(200);
      const stats = estimateTokenSavings(original, filtered);
      expect(stats.savings).toBe(50); // (400 - 200) / 4
      expect(stats.savingsPercent).toBe(50);
    });

    it('should handle empty output', () => {
      const stats = estimateTokenSavings('', '');
      expect(stats.savings).toBe(0);
      expect(stats.savingsPercent).toBe(0);
    });

    it('should handle zero original length', () => {
      const stats = estimateTokenSavings('', 'something');
      expect(stats.savingsPercent).toBe(0);
    });
  });
});