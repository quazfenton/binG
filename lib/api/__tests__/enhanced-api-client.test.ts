/**
 * Tests for Enhanced API Client
 *
 * Basic tests to verify the enhanced API client functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnhancedAPIClient } from '../enhanced-api-client';

const createMockResponse = (overrides: any = {}) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: vi.fn().mockResolvedValue({ data: 'test' }),
  text: vi.fn().mockResolvedValue('plain text'),
  ...overrides
});

describe('EnhancedAPIClient', () => {
  let client: EnhancedAPIClient;

  beforeEach(() => {
    client = new EnhancedAPIClient();
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    client.destroy();
  });

  describe('Basic Request Functionality', () => {
    it('should make a successful GET request', async () => {
      const mockResponse = createMockResponse({
        status: 200,
        statusText: 'OK',
        json: vi.fn().mockResolvedValue({ data: 'test' })
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      });

      expect(response.data).toEqual({ data: 'test' });
      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
    });

    it('should make a successful POST request with data', async () => {
      const mockResponse = createMockResponse({
        status: 201,
        statusText: 'Created',
        json: vi.fn().mockResolvedValue({ result: 'created' })
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'POST',
        data: { test: 'data' }
      });

      expect(response.data).toEqual({ result: 'created' });
      expect(response.status).toBe(201);
    });

    it('should handle network errors gracefully', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(
        client.request({ url: 'https://api.example.com/test', method: 'GET' })
      ).rejects.toThrow('Network error');
    });

    it('should handle timeout', async () => {
      (global.fetch as any).mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 1000);
        });
      });

      await expect(
        client.request({
          url: 'https://api.example.com/test',
          method: 'GET',
          timeout: 100
        })
      ).rejects.toThrow();
    });
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      const mockResponse = createMockResponse({
        status: 200,
        json: vi.fn().mockResolvedValue({ data: 'success' })
      });

      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: { maxAttempts: 3, backoffStrategy: 'fixed', baseDelay: 10, maxDelay: 100, jitter: false, retryableStatusCodes: [500, 502, 503, 504] }
      });

      expect(response.data).toEqual({ data: 'success' });
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should respect max retries', async () => {
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(
        client.request({
          url: 'https://api.example.com/test',
          method: 'GET',
          retries: { maxAttempts: 3, backoffStrategy: 'fixed', baseDelay: 10, maxDelay: 100, jitter: false, retryableStatusCodes: [500, 502, 503, 504] }
        })
      ).rejects.toThrow();

      expect(global.fetch).toHaveBeenCalledTimes(3); // 3 attempts (maxAttempts)
    });
  });

  describe('Headers and Configuration', () => {
    it('should include custom headers', async () => {
      const mockResponse = createMockResponse({
        json: vi.fn().mockResolvedValue({})
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      await client.request({
        url: 'https://api.example.com/test',
        method: 'GET',
        headers: { 'X-Custom-Header': 'test' }
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Custom-Header': 'test'
          })
        })
      );
    });

    it('should include default headers', async () => {
      const mockResponse = createMockResponse({
        json: vi.fn().mockResolvedValue({})
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      await client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
    });
  });

  describe('Response Handling', () => {
    it('should parse JSON response', async () => {
      const mockResponse = createMockResponse({
        json: vi.fn().mockResolvedValue({ key: 'value' })
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      });

      expect(response.data).toEqual({ key: 'value' });
    });

    it('should handle non-JSON response', async () => {
      const mockResponse = createMockResponse({
        headers: new Headers({ 'content-type': 'text/plain' }),
        json: undefined,
        text: vi.fn().mockResolvedValue('plain text')
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET',
        responseType: 'text'
      });

      expect(response.data).toBe('plain text');
    });

    it('should handle error responses', async () => {
      const mockResponse = createMockResponse({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Not found' })
      });

      (global.fetch as any).mockResolvedValue(mockResponse);

      await expect(
        client.request({ url: 'https://api.example.com/test', method: 'GET' })
      ).rejects.toThrow('Not Found');
    });
  });
});
