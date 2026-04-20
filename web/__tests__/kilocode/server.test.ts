/**
 * Kilocode Server Tests
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { KilocodeServer } from '../kilocode-server';
import { createKilocodeClient } from '../client';

describe('Kilocode Server', () => {
  let server: KilocodeServer;
  let client: any;

  beforeAll(async () => {
    // Start server on a test port
    server = new KilocodeServer({
      port: 3002,
      host: 'localhost',
      enableStreaming: false,
      maxRequestsPerHour: 100
    });

    await server.start();

    // Create client
    client = createKilocodeClient({
      port: 3002,
      host: 'localhost',
      timeout: 5000
    });
  }, 10000);

  afterAll(async () => {
    await server.stop();
  });

  describe('Health Check', () => {
    it('should respond to health check', async () => {
      const health = await (client as any).healthCheck();
      expect(health.status).toBe('healthy');
      expect(health.version).toBeDefined();
    });
  });

  describe('Code Generation', () => {
    it('should generate code from prompt', async () => {
      const response = await client.generate({
        prompt: 'Create a simple hello world function',
        language: 'javascript'
      });

      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
      expect(typeof response.data).toBe('string');
      expect(response.metadata).toBeDefined();
    });

    it('should validate language support', async () => {
      const response = await client.generate({
        prompt: 'test',
        language: 'unsupported'
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Unsupported language');
    });

    it('should validate required fields', async () => {
      const response = await client.generate({
        prompt: '',
        language: 'javascript'
      });

      expect(response.success).toBe(false);
      expect(response.error).toContain('Missing required fields');
    });
  });

  describe('Code Completion', () => {
    it('should provide code completions', async () => {
      const response = await client.complete({
        prefix: 'function hello() {',
        language: 'javascript'
      });

      expect(response.success).toBe(true);
      expect(Array.isArray(response.data)).toBe(true);
    });
  });

  describe('Code Analysis', () => {
    it('should analyze code', async () => {
      const response = await client.analyze({
        code: 'function test() { console.log("hello"); }',
        language: 'javascript',
        analysisType: 'lint'
      });

      expect(response.success).toBe(true);
      expect(response.data).toHaveProperty('issues');
      expect(response.data).toHaveProperty('metrics');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid requests gracefully', async () => {
      const response = await client.generate({
        prompt: 'test',
        language: 'javascript',
        options: { temperature: 10 } // Invalid temperature
      });

      // Server should handle this gracefully
      expect(response).toBeDefined();
    });

    it('should handle network errors', async () => {
      // Create client with invalid host
      const badClient = createKilocodeClient({
        port: 3002,
        host: 'invalid-host',
        timeout: 1000
      });

      await expect(badClient.generate({
        prompt: 'test',
        language: 'javascript'
      })).rejects.toThrow();
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      // This would require setting up a low rate limit for testing
      // For now, just verify the rate limiting is configured
      const config = server.getConfig();
      expect(config.maxRequestsPerHour).toBe(100);
    });
  });
});