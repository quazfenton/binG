/**
 * Tests for Secure Logger
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureLogger, logger, sanitizeForLogging, redactSensitiveData, createModuleLogger } from '@/lib/utils/secure-logger';

describe('Secure Logger', () => {
  beforeEach(() => {
    // Clear any leftover spy state from previous tests before re-spying.
    // Without this, vi.spyOn on an already-spied method returns the
    // existing spy with stale call counts, causing false failures.
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  describe('SecureLogger class', () => {
    it('should create logger instance', () => {
      const log = new SecureLogger();
      expect(log).toBeDefined();
    });

    it('should redact API keys', () => {
      const log = new SecureLogger();
      const redacted = log.redact('API Key: sk-abc123def456ghi789jkl012mno345');
      expect(redacted).toBe('API Key: [REDACTED]');
    });

    it('should redact AWS keys', () => {
      const log = new SecureLogger();
      const redacted = log.redact('AWS Key: AKIAIOSFODNN7EXAMPLE');
      expect(redacted).toBe('AWS Key: [REDACTED]');
    });

    it('should redact GitHub tokens', () => {
      const log = new SecureLogger();
      const redacted = log.redact('GitHub Token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(redacted).toBe('GitHub Token: [REDACTED]');
    });

    it('should redact Google OAuth tokens', () => {
      const log = new SecureLogger();
      const redacted = log.redact('Google Token: ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
      expect(redacted).toContain('[REDACTED]');
    });

    it('should redact api_key= patterns', () => {
      const log = new SecureLogger();
      const redacted = log.redact('api_key=abc123def456ghi789jkl012mno345pqr678');
      expect(redacted).toBe('api_key=[REDACTED]');
    });

    it('should redact token= patterns', () => {
      const log = new SecureLogger();
      const redacted = log.redact('token=abc123def456ghi789jkl012mno345pqr678stu901');
      expect(redacted).toBe('token=[REDACTED]');
    });

    it('should redact secret= patterns', () => {
      const log = new SecureLogger();
      const redacted = log.redact('secret=abc123def456ghi789jkl012mno345');
      expect(redacted).toBe('secret=[REDACTED]');
    });

    it('should redact password= patterns', () => {
      const log = new SecureLogger();
      const redacted = log.redact('password=mysecretpassword123');
      expect(redacted).toBe('password=[REDACTED]');
    });

    it('should redact bearer tokens', () => {
      const log = new SecureLogger();
      const redacted = log.redact('Authorization: Bearer abc123def456ghi789jkl012mno345pqr678stu901vwx234');
      expect(redacted).toContain('[REDACTED]');
    });

    it('should NOT redact short strings', () => {
      const log = new SecureLogger();
      const redacted = log.redact('Short string: abc123');
      expect(redacted).toBe('Short string: abc123');
    });

    it('should disable redaction when configured', () => {
      const log = new SecureLogger({ enableRedaction: false });
      const redacted = log.redact('API Key: sk-abc123def456ghi789jkl012mno345');
      expect(redacted).toBe('API Key: sk-abc123def456ghi789jkl012mno345');
    });
  });

  describe('redactObject', () => {
    it('should redact sensitive keys in object', () => {
      const log = new SecureLogger();
      const obj = {
        apiKey: 'sk-abc123def456ghi789jkl012mno345',
        data: 'test',
        nested: {
          token: 'abc123def456ghi789jkl012mno345pqr678stu901',
        },
      };

      const redacted = log.redactObject(obj);

      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.data).toBe('test');
      expect(redacted.nested.token).toBe('[REDACTED]');
    });

    it('should handle arrays', () => {
      const log = new SecureLogger();
      const obj = {
        items: [
          { apiKey: 'sk-123' },
          { data: 'test' },
        ],
      };

      const redacted = log.redactObject(obj);

      expect(redacted.items[0].apiKey).toBe('[REDACTED]');
      expect(redacted.items[1].data).toBe('test');
    });

    it('should handle null and undefined', () => {
      const log = new SecureLogger();

      expect(log.redactObject(null)).toBe(null);
      expect(log.redactObject(undefined)).toBe(undefined);
    });

    it('should respect depth limit', () => {
      const log = new SecureLogger();
      const obj = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  apiKey: 'sk-123',
                },
              },
            },
          },
        },
      };

      const redacted = log.redactObject(obj, 3);
      expect(redacted.level1.level2.level3).toBe('[Maximum depth exceeded]');
    });
  });

  describe('logging methods', () => {
    it('should log info messages', () => {
      const log = new SecureLogger({ level: 'info' });
      log.info('Test message');
      expect(console.log).toHaveBeenCalled();
    });

    it('should log warning messages', () => {
      const log = new SecureLogger({ level: 'warn' });
      log.warn('Test warning');
      expect(console.warn).toHaveBeenCalled();
    });

    it('should log error messages', () => {
      const log = new SecureLogger({ level: 'error' });
      log.error('Test error');
      expect(console.error).toHaveBeenCalled();
    });

    it('should not log debug when level is info', () => {
      const log = new SecureLogger({ level: 'info' });
      log.debug('Test debug');
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should log debug when level is debug', () => {
      const log = new SecureLogger({ level: 'debug' });
      log.debug('Test debug');
      expect(console.log).toHaveBeenCalled();
    });

    it('should not log anything when level is silent', () => {
      const log = new SecureLogger({ level: 'silent' });
      log.info('Test');
      log.warn('Test');
      log.error('Test');
      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
    });

    it('should add prefix to messages', () => {
      const log = new SecureLogger({ prefix: '[Test]' });
      log.info('Message');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Test]')
      );
    });

    it('should add timestamps', () => {
      const log = new SecureLogger({ enableTimestamps: true });
      log.info('Message');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      );
    });
  });

  describe('child logger', () => {
    it('should create child logger with prefix', () => {
      const parent = new SecureLogger({ prefix: '[Parent]' });
      const child = parent.child('[Child]');

      child.info('Message');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[Parent] [Child]')
      );
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      const log = new SecureLogger({ level: 'info' });
      log.configure({ level: 'debug' });

      log.debug('Test');
      expect(console.log).toHaveBeenCalled();
    });

    it('should enable redaction', () => {
      const log = new SecureLogger({ enableRedaction: false });
      log.enableRedaction();

      const redacted = log.redact('sk-123');
      expect(redacted).toBe('[REDACTED]');
    });

    it('should disable redaction', () => {
      const log = new SecureLogger({ enableRedaction: true });
      log.disableRedaction();

      const redacted = log.redact('sk-123');
      expect(redacted).toBe('sk-123');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Redaction disabled'));
    });
  });
});

describe('helper functions', () => {
  describe('sanitizeForLogging', () => {
    it('should sanitize object', () => {
      const obj = { apiKey: 'sk-123', data: 'test' };
      const safe = sanitizeForLogging(obj);
      expect(safe.apiKey).toBe('[REDACTED]');
      expect(safe.data).toBe('test');
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact string', () => {
      const text = 'API Key: sk-abc123def456ghi789jkl012mno345';
      const redacted = redactSensitiveData(text);
      expect(redacted).toBe('API Key: [REDACTED]');
    });
  });

  describe('createModuleLogger', () => {
    it('should create logger with module prefix', () => {
      const log = createModuleLogger('TestModule');
      log.info('Message');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[TestModule]')
      );
    });
  });

  describe('default logger', () => {
    it('should export default logger', () => {
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(SecureLogger);
    });
  });
});
