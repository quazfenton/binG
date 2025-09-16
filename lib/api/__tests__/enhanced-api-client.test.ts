/**
 * Tests for Enhanced API Client
 * 
 * Basic tests to verify the enhanced API client functionality
 */

import { EnhancedAPIClient } from '../enhanced-api-client';

// Mock fetch for testing
global.fetch = jest.fn();

describe('EnhancedAPIClient', () => {
  let client: EnhancedAPIClient;

  beforeEach(() => {
    client = new EnhancedAPIClient();
    jest.clearAllMocks();
  });

  afterEach(() => {
    client.destroy();
  });

  describe('Basic Request Functionality', () => {
    it('should make a successful GET request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: jest.fn().resolve({ data: 'test' })
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      });

      expect(response.data).toEqual({ data: 'test' });
      expect(response.status).toBe(200);
      expect(response.statusText).toBe('OK');
    });

    it('should make a successful POST request with data', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Map([['content-type', 'application/json']]),
        json: jest.fn().resolve({ id: 1, created: true })
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const testData = { name: 'test', value: 123 };
      const response = await client.request({
        url: 'https://api.example.com/create',
        method: 'POST',
        data: testData
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/create',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(testData),
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );

      expect(response.data).toEqual({ id: 1, created: true });
    });
  });

  describe('Error Handling', () => {
    it('should handle HTTP errors correctly', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Map(),
        json: jest.fn().resolve({ error: 'Resource not found' })
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(client.request({
        url: 'https://api.example.com/notfound',
        method: 'GET'
      })).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      })).rejects.toThrow('Network error');
    });

    it('should create user-friendly error messages', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: new Map()
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      try {
        await client.request({
          url: 'https://api.example.com/protected',
          method: 'GET'
        });
      } catch (error: any) {
        expect(error.userMessage).toBe('Authentication failed. Please check your API key.');
        expect(error.status).toBe(401);
        expect(error.isRetryable).toBe(false);
      }
    });
  });

  describe('Retry Logic', () => {
    it('should retry on retryable errors', async () => {
      const mockResponse = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map()
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValueOnce(mockResponse)
        .mockResolvedValue({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'application/json']]),
          json: jest.fn().resolve({ success: true })
        });

      const response = await client.request({
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: {
          maxAttempts: 3,
          backoffStrategy: 'fixed',
          baseDelay: 100,
          maxDelay: 1000,
          jitter: false,
          retryableStatusCodes: [503]
        }
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(response.data).toEqual({ success: true });
    });

    it('should not retry on non-retryable errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Map()
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      await expect(client.request({
        url: 'https://api.example.com/test',
        method: 'GET',
        retries: {
          maxAttempts: 3,
          backoffStrategy: 'fixed',
          baseDelay: 100,
          maxDelay: 1000,
          jitter: false,
          retryableStatusCodes: [503] // 400 is not in the list
        }
      })).rejects.toThrow();

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fallback System', () => {
    it('should try fallback endpoints when primary fails', async () => {
      const primaryError = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map()
      };

      const fallbackSuccess = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: jest.fn().resolve({ data: 'fallback-success' })
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(primaryError) // Primary fails
        .mockResolvedValue(fallbackSuccess); // Fallback succeeds

      const primaryConfig = {
        url: 'https://primary.example.com/api',
        method: 'GET' as const
      };

      const fallbackConfigs = [{
        url: 'https://fallback.example.com/api',
        method: 'GET' as const
      }];

      const response = await client.withFallback(primaryConfig, fallbackConfigs);

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(response.data).toEqual({ data: 'fallback-success' });
    });

    it('should fail when all endpoints fail', async () => {
      const errorResponse = {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Map()
      };

      (global.fetch as jest.Mock).mockResolvedValue(errorResponse);

      const primaryConfig = {
        url: 'https://primary.example.com/api',
        method: 'GET' as const
      };

      const fallbackConfigs = [
        { url: 'https://fallback1.example.com/api', method: 'GET' as const },
        { url: 'https://fallback2.example.com/api', method: 'GET' as const }
      ];

      await expect(
        client.withFallback(primaryConfig, fallbackConfigs)
      ).rejects.toThrow('All endpoints failed');

      expect(global.fetch).toHaveBeenCalledTimes(3); // Primary + 2 fallbacks
    });
  });

  describe('Circuit Breaker', () => {
    it('should track endpoint health', async () => {
      const successResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: jest.fn().resolve({ success: true })
      };

      (global.fetch as jest.Mock).mockResolvedValue(successResponse);

      await client.request({
        url: 'https://api.example.com/test',
        method: 'GET'
      });

      const health = client.getEndpointHealth('https://api.example.com/test');
      expect(health).toBeDefined();
      expect((health as any).isHealthy).toBe(true);
    });

    it('should provide circuit breaker statistics', () => {
      const stats = client.getCircuitBreakerStats();
      expect(Array.isArray(stats)).toBe(true);
    });
  });

  describe('Health Monitoring', () => {
    it('should perform health checks', async () => {
      const healthResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        json: jest.fn().resolve({ status: 'healthy' })
      };

      (global.fetch as jest.Mock).mockResolvedValue(healthResponse);

      const isHealthy = await client.performHealthCheck('https://api.example.com');
      expect(isHealthy).toBe(true);
    });

    it('should handle health check failures', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const isHealthy = await client.performHealthCheck('https://api.example.com');
      expect(isHealthy).toBe(false);
    });
  });
});

// Mock setTimeout for testing delays
jest.useFakeTimers();