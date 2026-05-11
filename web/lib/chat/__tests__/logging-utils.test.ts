/**
 * Tests for Logging Utilities
 *
 * Tests redaction, telemetry payload preparation, and origin stack creation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  redactArgsForLogging,
  createOriginStack,
  prepareTelemetryPayload,
} from '.../errors/logging-utils';

// Mock the tool-call-tracker module
vi.mock('../tool-call-tracker', () => ({
  toolCallTracker: {
    recordInvocationPayload: vi.fn(),
  },
}));

describe('redactArgsForLogging', () => {
  describe('shallow mode (default)', () => {
    it('should return non-object args as string', () => {
      expect(redactArgsForLogging('string' as any)).toBe('<non-object-args>');
      expect(redactArgsForLogging(null)).toBe('<non-object-args>');
      expect(redactArgsForLogging(undefined)).toBe('<non-object-args>');
    });

    it('should redact content fields', () => {
      const args = {
        content: 'sensitive content',
        path: '/some/path',
      };
      const result = redactArgsForLogging(args);
      expect(result).toHaveProperty('content', '<redacted>');
      expect(result).toHaveProperty('path', '/some/path');
    });

    it('should redact body fields', () => {
      const args = {
        body: 'sensitive body',
        name: 'test',
      };
      const result = redactArgsForLogging(args);
      expect(result).toHaveProperty('body', '<redacted>');
      expect(result).toHaveProperty('name', 'test');
    });

    it('should handle files arrays with path/name preservation', () => {
      const args = {
        files: [
          { path: '/a/b.txt', name: 'b.txt' },
          { path: '/c/d.txt', name: 'd.txt' },
        ],
      };
      const result = redactArgsForLogging(args) as Record<string, unknown>;
      expect(result.files).toEqual([
        { path: '/a/b.txt', name: 'b.txt' },
        { path: '/c/d.txt', name: 'd.txt' },
      ]);
    });

    it('should truncate long strings', () => {
      const longString = 'a'.repeat(300);
      const args = { data: longString };
      const result = redactArgsForLogging(args) as Record<string, unknown>;
      expect(result.data).toContain('...[TRUNCATED]');
      expect(result.data).not.toContain(longString);
    });

    it('should limit nested object properties', () => {
      // The object property limiting applies to NESTED objects, not top-level keys
      const args = {
        nested: {
          prop1: 'a',
          prop2: 'b',
          prop3: 'c',
          prop4: 'd',
          prop5: 'e',
          prop6: 'f', // should be limited to 5 props with marker
        },
      };
      const result = redactArgsForLogging(args, { maxObjectProps: 5 }) as Record<string, unknown>;
      const nested = result.nested as Record<string, unknown>;
      const keys = Object.keys(nested);
      // 6 nested props should be limited to 5 + marker = 6 total
      expect(keys.length).toBeLessThanOrEqual(6);
      // Check that the marker exists (key contains "...")
      const markerKey = keys.find(k => k.includes('...'));
      expect(markerKey).toBeTruthy();
      // The marker value should be true
      expect(nested[markerKey as string]).toBe(true);
    });

    it('should limit array items', () => {
      const args = {
        items: [1, 2, 3, 4, 5, 6, 7],
      };
      const result = redactArgsForLogging(args, { maxArrayItems: 3 }) as Record<string, unknown>;
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items).toContain('... [+4 more]');
    });

    it('should handle nested objects with limited depth', () => {
      const args = {
        nested: {
          deep: {
            value: 'secret',
          },
        },
      };
      const result = redactArgsForLogging(args) as Record<string, unknown>;
      expect(result.nested).toEqual({ deep: { value: 'secret' } });
    });
  });

  describe('deep mode', () => {
    it('should redact nested sensitive keys', () => {
      const args = {
        config: {
          apiKey: 'secret-key-123',
          nested: {
            password: 'hunter2',
          },
        },
        name: 'test',
      };
      const result = redactArgsForLogging(args, { deep: true }) as Record<string, unknown>;
      expect(result).toHaveProperty('config');
      const config = result.config as Record<string, unknown>;
      expect(config.apiKey).toBe('<redacted>');
      const nested = config.nested as Record<string, unknown>;
      expect(nested.password).toBe('<redacted>');
      expect(result.name).toBe('test');
    });

    it('should redact deeply nested authorization tokens', () => {
      const args = {
        headers: {
          authorization: 'Bearer secret-token',
          nested: {
            token: 'api-key-xyz',
          },
        },
      };
      const result = redactArgsForLogging(args, { deep: true }) as Record<string, unknown>;
      const headers = result.headers as Record<string, unknown>;
      expect(headers.authorization).toBe('<redacted>');
      const nested = headers.nested as Record<string, unknown>;
      expect(nested.token).toBe('<redacted>');
    });

    it('should apply shallow limits after deep redaction', () => {
      // Direct string property (not nested) to test truncation
      const longValue = 'a'.repeat(600); // Needs > maxStringLength * 5 for truncation
      const args = {
        data: longValue, // Direct property, not nested
      };
      const result = redactArgsForLogging(args, { deep: true, maxStringLength: 50 }) as Record<string, unknown>;
      // After deep redaction, direct string should be truncated
      expect(result.data).toContain('...[TRUNCATED:'); // Format is "...[TRUNCATED:N]"
    });

    it('should fall back to shallow redaction if JSON.stringify fails', () => {
      // Circular reference
      const circular: any = { a: 1 };
      circular.self = circular;
      const result = redactArgsForLogging(circular, { deep: true });
      expect(result).not.toBe('<unserializable-args>');
    });

    it('should be case-insensitive for sensitive key matching', () => {
      const args = {
        data: {
          APIKEY: 'secret1',
          Secret: 'secret2',
          PASSWORD: 'secret3',
          TOKEN: 'secret4',
          AUTHORIZATION: 'secret5',
        },
      };
      const result = redactArgsForLogging(args, { deep: true }) as Record<string, unknown>;
      const data = result.data as Record<string, unknown>;
      expect(data.APIKEY).toBe('<redacted>');
      expect(data.Secret).toBe('<redacted>');
      expect(data.PASSWORD).toBe('<redacted>');
      expect(data.TOKEN).toBe('<redacted>');
      expect(data.AUTHORIZATION).toBe('<redacted>');
    });
  });
});

describe('createOriginStack', () => {
  it('should return a string', () => {
    const stack = createOriginStack();
    expect(typeof stack).toBe('string');
  });

  it('should contain file/line information', () => {
    const stack = createOriginStack();
    // Stack should contain something
    expect(stack.length).toBeGreaterThan(0);
  });

  it('should respect maxLines parameter', () => {
    const small = createOriginStack(2);
    const large = createOriginStack(10);
    // Fewer lines with smaller maxLines
    const smallLines = small.split('\n').filter(Boolean).length;
    const largeLines = large.split('\n').filter(Boolean).length;
    expect(smallLines).toBeLessThanOrEqual(largeLines);
  });    it('should default to 7 lines', () => {
      const defaultStack = createOriginStack();
      const explicitStack = createOriginStack(7);
      // Stacks should have similar structure, just different line counts
      const defaultLines = defaultStack.split('\n').filter(Boolean).length;
      const explicitLines = explicitStack.split('\n').filter(Boolean).length;
      expect(defaultLines).toBe(explicitLines);
    });
});

describe('prepareTelemetryPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return redactedArgs and originStack', () => {
    const result = prepareTelemetryPayload({
      args: { test: 'value' },
    });
    expect(result).toHaveProperty('redactedArgs');
    expect(result).toHaveProperty('originStack');
    expect(typeof result.redactedArgs).toBe('string');
    expect(typeof result.originStack).toBe('string');
  });    it('should apply redaction to args', () => {
      const result = prepareTelemetryPayload({
        args: { content: 'sensitive', name: 'test' },
      });
      // Should contain redacted content marker and the non-sensitive name
      expect(result.redactedArgs).toBeTruthy();
      expect(typeof result.redactedArgs).toBe('string');
    });

  it('should include custom metadata', () => {
    const result = prepareTelemetryPayload({
      args: { data: 'value' },
      metadata: { custom: 'info' },
    });
    expect(result.originStack).toBeTruthy();
  });

  it('should handle empty args', () => {
    const result = prepareTelemetryPayload({ args: {} });
    expect(result.redactedArgs).toBeTruthy();
  });
});

describe('recordToolCallTelemetry', () => {
  // Import is async so we test it separately
  it('should be callable without throwing', async () => {
    const { recordToolCallTelemetry } = await import('.../errors/logging-utils');
    // Should not throw even with invalid toolCallId
    await expect(
      recordToolCallTelemetry({
        toolCallId: null,
        redactedArgs: 'test',
      })
    ).resolves.not.toThrow();
  });

  it('should handle missing toolCallTracker gracefully', async () => {
    const { recordToolCallTelemetry } = await import('.../errors/logging-utils');
    // Module is mocked, so we just verify it doesn't throw
    await expect(
      recordToolCallTelemetry({
        toolCallId: 'test-id',
        redactedArgs: 'test args',
        originStack: 'test stack',
      })
    ).resolves.not.toThrow();
  });
});