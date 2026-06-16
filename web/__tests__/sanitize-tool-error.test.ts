import { describe, it, expect } from 'vitest';
import { sanitizeToolError } from '@/lib/orchestra/shared-agent-context';

describe('sanitizeToolError', () => {
  it('strips internal Unix paths', () => {
    expect(sanitizeToolError('ENOENT: no such file /home/user/secret/project/app.ts'))
      .toBe('ENOENT: no such file [path]');
  });

  it('strips /usr, /opt, /var, /tmp paths', () => {
    expect(sanitizeToolError('failed to read /usr/local/bin/node')).toBe('failed to read [path]');
    expect(sanitizeToolError('config at /opt/bing/.env not found')).toBe('config at [path] not found');
    expect(sanitizeToolError('temp file /tmp/build-1234.log')).toBe('temp file [path]');
  });

  it('strips credentials from error messages', () => {
    expect(sanitizeToolError('api_key=sk-abc123def456ghi789')).toBe('[redacted]');
    expect(sanitizeToolError('token: ghp_xxxxxxxxxxxx')).toBe('[redacted]');
    expect(sanitizeToolError('secret=my-s3cr3t-v4lu3')).toBe('[redacted]');
  });

  it('strips Bearer/Basic auth headers', () => {
    expect(sanitizeToolError('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc'))
      .toBe('Authorization: [redacted-auth]');
    expect(sanitizeToolError('Basic dXNlcjpwYXNz')).toBe('[redacted-auth]');
  });

  it('strips stack frames', () => {
    const withStack = 'Tool failed at Object.execute (file:///opt/bing/web/lib/tools/runner.ts:42:15)';
    expect(sanitizeToolError(withStack)).toBe('Tool failed [stack-frame]');
  });

  it('strips email addresses', () => {
    expect(sanitizeToolError('user admin@example.com not authorized'))
      .toBe('user [email] not authorized');
  });

  it('truncates long errors to 200 chars', () => {
    const long = 'x'.repeat(300);
    const result = sanitizeToolError(long);
    expect(result.length).toBe(203); // 200 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('preserves categorization-relevant error strings', () => {
    expect(sanitizeToolError('no such tool: grep_code')).toBe('no such tool: grep_code');
    expect(sanitizeToolError('capability not found: advanced_search')).toBe('capability not found: advanced_search');
    expect(sanitizeToolError('[TIMEOUT-TTFT] No first token received after 75000ms'))
      .toBe('[TIMEOUT-TTFT] No first token received after 75000ms');
    expect(sanitizeToolError('ENOENT: spawn python3')).toBe('ENOENT: spawn python3');
    expect(sanitizeToolError('idle timeout: 75000ms')).toBe('idle timeout: 75000ms');
  });

  it('preserves short safe error messages', () => {
    expect(sanitizeToolError('permission denied')).toBe('permission denied');
    expect(sanitizeToolError('repeated failure')).toBe('repeated failure');
    expect(sanitizeToolError('Unknown error')).toBe('Unknown error');
  });

  it('handles empty string', () => {
    expect(sanitizeToolError('')).toBe('');
  });
});
