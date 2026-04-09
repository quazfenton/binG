/**
 * Chat Request Logger — Telemetry Tracking Tests
 *
 * Verifies that fallback model latency is recorded under the ACTUAL
 * provider/model name, not the originally requested one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chatRequestLogger } from '@/lib/chat/chat-request-logger';

describe('ChatRequestLogger — Telemetry Tracking', () => {
  const testPrefix = `telemetry-${Date.now()}`;

  beforeEach(async () => {
    await chatRequestLogger.initialize();
  });

  afterEach(() => {
    // Clean up test rows
    try {
      const db = (chatRequestLogger as any).db;
      if (db) {
        db.exec(`DELETE FROM chat_request_logs WHERE id LIKE '${testPrefix}%'`);
      }
    } catch {}
  });

  describe('logRequestStart + logRequestComplete', () => {
    it('should record initial provider/model on logRequestStart', async () => {
      const requestId = `${testPrefix}-001`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'mistral',
        'mistral-large-latest',
        [{ role: 'user', content: 'hello' }],
        true
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('mistral');
      expect(row.model).toBe('mistral-large-latest');
    });

    it('should update latency without changing provider/model when actualProvider/actualModel are omitted', async () => {
      const requestId = `${testPrefix}-002`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'mistral',
        'mistral-large-latest',
        [],
        true
      );

      await chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        1500,
        undefined
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model, latency_ms, success FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('mistral');
      expect(row.model).toBe('mistral-large-latest');
      expect(row.latency_ms).toBe(1500);
      expect(row.success).toBe(1);
    });

    it('should OVERRIDE provider/model when actualProvider/actualModel are provided (fallback scenario)', async () => {
      const requestId = `${testPrefix}-003`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'mistral',
        'mistral-large-latest',
        [],
        true
      );

      await chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        3200,
        undefined,
        'openai',
        'gpt-4o-mini'
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model, latency_ms FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('openai');
      expect(row.model).toBe('gpt-4o-mini');
      expect(row.latency_ms).toBe(3200);
    });

    it('should NOT override provider/model when actualProvider/actualModel are empty string', async () => {
      const requestId = `${testPrefix}-004`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'mistral',
        'mistral-large-latest',
        [],
        true
      );

      // Pass empty strings — should NOT override (|| null converts to null)
      await chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        800,
        undefined,
        '',
        ''
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model, latency_ms FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('mistral');
      expect(row.model).toBe('mistral-large-latest');
      expect(row.latency_ms).toBe(800);
    });

    it('should NOT override provider/model when actualProvider/actualModel are undefined', async () => {
      const requestId = `${testPrefix}-005`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'openai',
        'gpt-4o',
        [],
        true
      );

      await chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        2100,
        undefined,
        undefined,
        undefined
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model, latency_ms FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('openai');
      expect(row.model).toBe('gpt-4o');
      expect(row.latency_ms).toBe(2100);
    });

    it('should correctly track a multi-fallback chain: original → fallback1 → fallback2', async () => {
      const requestId = `${testPrefix}-006`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'mistral',
        'mistral-large-latest',
        [],
        true
      );

      // First fallback fails
      await chatRequestLogger.logRequestComplete(
        requestId,
        false,
        undefined,
        undefined,
        5000,
        'Rate limited',
        'openai',
        'gpt-4o-mini'
      );

      const db = (chatRequestLogger as any).db;
      let row = db.prepare('SELECT provider, model, latency_ms, error FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('openai');
      expect(row.model).toBe('gpt-4o-mini');
      expect(row.latency_ms).toBe(5000);
      expect(row.error).toBe('Rate limited');

      // Second fallback succeeds
      await chatRequestLogger.logRequestComplete(
        requestId,
        true,
        undefined,
        undefined,
        8000,
        undefined,
        'google',
        'gemini-1.5-flash'
      );

      row = db.prepare('SELECT provider, model, latency_ms, error, success FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('google');
      expect(row.model).toBe('gemini-1.5-flash');
      expect(row.latency_ms).toBe(8000);
      expect(row.error).toBe(null);
      expect(row.success).toBe(1);
    });

    it('should handle error case with actualProvider/actualModel', async () => {
      const requestId = `${testPrefix}-007`;
      await chatRequestLogger.logRequestStart(
        requestId,
        'user-123',
        'openai',
        'gpt-4',
        [],
        false
      );

      await chatRequestLogger.logRequestComplete(
        requestId,
        false,
        undefined,
        undefined,
        12000,
        'Connection timeout',
        'openai',
        'gpt-4'
      );

      const db = (chatRequestLogger as any).db;
      const row = db.prepare('SELECT provider, model, latency_ms, error, success FROM chat_request_logs WHERE id = ?').get(requestId);
      expect(row.provider).toBe('openai');
      expect(row.model).toBe('gpt-4');
      expect(row.latency_ms).toBe(12000);
      expect(row.error).toBe('Connection timeout');
      expect(row.success).toBe(0);
    });
  });
});
