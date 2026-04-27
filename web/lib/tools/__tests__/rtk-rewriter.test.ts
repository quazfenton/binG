import { rewriteCommand, filterOutput, hasRewriteRule, estimateTokenSavings } from '../rtk-rewriter';

describe('RTK Command Rewriter', () => {
  describe('rewriteCommand', () => {
    it('should rewrite git status to short format', () => {
      expect(rewriteCommand('git status')).toBe('git status --short');
    });

    it('should rewrite git log to oneline', () => {
      expect(rewriteCommand('git log')).toBe('git log --oneline -20');
    });

    it('should rewrite git diff to stat', () => {
      expect(rewriteCommand('git diff')).toBe('git diff --stat');
    });

    it('should not rewrite unknown commands', () => {
      expect(rewriteCommand('echo hello')).toBe('echo hello');
      expect(rewriteCommand('cat file.txt')).toBe('cat file.txt');
    });

    it('should rewrite npm test to JSON output', () => {
      expect(rewriteCommand('npm test')).toBe('npm test -- --json 2>&1 | head -50');
    });

    it('should rewrite cargo test to quiet', () => {
      expect(rewriteCommand('cargo test')).toBe('cargo test -- --quiet');
    });

    it('should rewrite docker ps to compact format', () => {
      expect(rewriteCommand('docker ps')).toBe('docker ps --format "{{.ID}} {{.Status}}"');
    });

    it('should rewrite ls -la to ls -F', () => {
      expect(rewriteCommand('ls -la')).toBe('ls -F');
    });

    it('should rewrite vitest to basic reporter', () => {
      expect(rewriteCommand('vitest run')).toBe('vitest run --reporter=basic');
    });

    it('should rewrite pytest to quiet', () => {
      expect(rewriteCommand('pytest')).toBe('pytest -q --tb=no');
    });
  });

  describe('hasRewriteRule', () => {
    it('should return true for git status', () => {
      expect(hasRewriteRule('git status')).toBe(true);
    });

    it('should return true for npm test', () => {
      expect(hasRewriteRule('npm test')).toBe(true);
    });

    it('should return false for echo', () => {
      expect(hasRewriteRule('echo hello')).toBe(false);
    });
  });

  describe('filterOutput', () => {
    it('should remove ANSI codes', () => {
      const output = '\x1b[32mSuccess\x1b[0m';
      const filtered = filterOutput('echo test', output);
      expect(filtered).toBe('Success');
    });

    it('should truncate long output by lines', () => {
      const lines = Array(150).fill('test line').join('\n');
      const filtered = filterOutput('ls', lines, { maxLines: 50 });
      expect(filtered.split('\n').length).toBeLessThanOrEqual(51);
      expect(filtered).toContain('truncated');
    });

    it('should truncate long output by characters', () => {
      const output = 'a'.repeat(60000);
      const filtered = filterOutput('echo test', output, { maxChars: 5000 });
      expect(filtered.length).toBeLessThanOrEqual(5005);
      expect(filtered).toContain('truncated');
    });
  });

  describe('estimateTokenSavings', () => {
    it('should calculate token savings', () => {
      const original = 'line 1\nline 2\nline 3'; // 19 chars
      const filtered = 'line 1'; // 6 chars
      const stats = estimateTokenSavings(original, filtered);
      
      expect(stats.original).toBe(5); // ceil(19/4)
      expect(stats.filtered).toBe(2); // ceil(6/4)
      expect(stats.savings).toBe(3);
      expect(stats.savingsPercent).toBeGreaterThan(0);
    });
  });
});