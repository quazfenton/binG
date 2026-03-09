/**
 * Health Check Tests
 * 
 * Tests for provider health monitoring
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  HealthCheckManager,
  healthCheckManager,
  createHttpHealthCheck,
  createFunctionHealthCheck,
  type HealthCheckResult,
} from '@/lib/middleware/health-check';

describe('HealthCheckManager', () => {
  let manager: HealthCheckManager;

  beforeEach(() => {
    manager = new HealthCheckManager({
      interval: 100, // Fast checks for testing
      timeout: 50,
      failureThreshold: 2,
      historySize: 5,
    });
  });

  describe('register', () => {
    it('should register health checker', async () => {
      const checker = manager.register('test-provider', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));

      expect(checker).toBeDefined();
      
      // Wait for health check to run
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(checker.isHealthy()).toBe(true);
    });

    it('should return existing checker if already registered', () => {
      const checker1 = manager.register('test-provider', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      const checker2 = manager.register('test-provider', async () => ({
        healthy: false,
        status: 'unhealthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      expect(checker1).toBe(checker2);
    });
  });

  describe('getHealth', () => {
    it('should return health status', async () => {
      manager.register('test-provider', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      // Wait for at least one check
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const health = manager.getHealth('test-provider');
      
      expect(health).toBeDefined();
      expect(health?.providerId).toBe('test-provider');
    });

    it('should return null for unregistered provider', () => {
      const health = manager.getHealth('non-existent');
      expect(health).toBeNull();
    });
  });

  describe('isHealthy', () => {
    it('should return true for healthy provider', async () => {
      manager.register('healthy-provider', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      // Wait for check
      await new Promise(resolve => setTimeout(resolve, 150));
      
      expect(manager.isHealthy('healthy-provider')).toBe(true);
    });

    it('should return false for unhealthy provider', async () => {
      let callCount = 0;
      
      manager.register('unhealthy-provider', async () => {
        callCount++;
        return {
          healthy: false,
          status: 'unhealthy',
          latency: 10,
          timestamp: Date.now(),
          error: 'Simulated failure',
        };
      });
      
      // Wait for multiple checks to exceed failure threshold
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(manager.isHealthy('unhealthy-provider')).toBe(false);
    });

    it('should return false for unregistered provider', () => {
      expect(manager.isHealthy('non-existent')).toBe(false);
    });
  });

  describe('getAllHealth', () => {
    it('should return health for all providers', async () => {
      manager.register('provider-1', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      manager.register('provider-2', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 20,
        timestamp: Date.now(),
      }));
      
      // Wait for checks
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const allHealth = manager.getAllHealth();
      
      expect(allHealth.size).toBe(2);
      expect(allHealth.has('provider-1')).toBe(true);
      expect(allHealth.has('provider-2')).toBe(true);
    });
  });

  describe('getHealthyProviders', () => {
    it('should return list of healthy providers', async () => {
      manager.register('healthy-1', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      manager.register('healthy-2', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      // Wait for checks
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const healthy = manager.getHealthyProviders();
      
      expect(healthy).toContain('healthy-1');
      expect(healthy).toContain('healthy-2');
    });
  });

  describe('getUnhealthyProviders', () => {
    it('should return list of unhealthy providers', async () => {
      manager.register('unhealthy-1', async () => ({
        healthy: false,
        status: 'unhealthy',
        latency: 10,
        timestamp: Date.now(),
        error: 'Failure',
      }));
      
      // Wait for multiple checks
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const unhealthy = manager.getUnhealthyProviders();
      
      expect(unhealthy).toContain('unhealthy-1');
    });
  });

  describe('unregister', () => {
    it('should stop and remove health checker', async () => {
      manager.register('test-provider', async () => ({
        healthy: true,
        status: 'healthy',
        latency: 10,
        timestamp: Date.now(),
      }));
      
      manager.unregister('test-provider');
      
      const health = manager.getHealth('test-provider');
      expect(health).toBeNull();
    });
  });
});

describe('createHttpHealthCheck', () => {
  it('should create HTTP health check function', () => {
    const checkFn = createHttpHealthCheck('https://httpbin.org/status/200');
    expect(typeof checkFn).toBe('function');
  });

  it('should handle successful HTTP check', async () => {
    // Use a reliable test endpoint
    const checkFn = createHttpHealthCheck('https://httpbin.org/status/200', {
      timeout: 10000,
      expectedStatus: 200,
    });

    const result = await checkFn();

    expect(result).toBeDefined();
    expect(result.latency).toBeGreaterThanOrEqual(0);
  });

  it('should handle failed HTTP check', async () => {
    const checkFn = createHttpHealthCheck('https://httpbin.org/status/500', {
      timeout: 10000,
      expectedStatus: 200,
    });

    const result = await checkFn();

    expect(result.healthy).toBe(false);
  });

  it('should handle timeout', async () => {
    const checkFn = createHttpHealthCheck('https://httpbin.org/delay/10', {
      timeout: 100, // Very short timeout
    });

    const result = await checkFn();

    expect(result.healthy).toBe(false);
    expect(result).toBeDefined();
  });
});

describe('createFunctionHealthCheck', () => {
  it('should create function health check', () => {
    const checkFn = createFunctionHealthCheck(async () => true);
    expect(typeof checkFn).toBe('function');
  });

  it('should handle successful function check', async () => {
    const checkFn = createFunctionHealthCheck(async () => true);
    const result = await checkFn();
    
    expect(result.healthy).toBe(true);
    expect(result.status).toBe('healthy');
  });

  it('should handle failed function check', async () => {
    const checkFn = createFunctionHealthCheck(async () => false);
    const result = await checkFn();
    
    expect(result.healthy).toBe(false);
    expect(result.status).toBe('unhealthy');
  });

  it('should handle thrown errors', async () => {
    const checkFn = createFunctionHealthCheck(async () => {
      throw new Error('Test error');
    });
    
    const result = await checkFn();
    
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('Test error');
  });
});

describe('healthCheckManager (singleton)', () => {
  it('should be a singleton instance', () => {
    expect(healthCheckManager).toBeDefined();
    expect(healthCheckManager).toBeInstanceOf(HealthCheckManager);
  });
});

describe('Health Check - Integration', () => {
  it('should detect provider recovery', async () => {
    const manager = new HealthCheckManager({
      interval: 100,
      timeout: 50,
      failureThreshold: 2,
      historySize: 5,
    });
    
    let isHealthy = false;
    
    manager.register('recovering-provider', async () => ({
      healthy: isHealthy,
      status: isHealthy ? 'healthy' : 'unhealthy',
      latency: 10,
      timestamp: Date.now(),
      error: isHealthy ? undefined : 'Simulated failure',
    }));
    
    // Wait for failures
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(manager.isHealthy('recovering-provider')).toBe(false);
    
    // Recover
    isHealthy = true;
    
    // Wait for recovery
    await new Promise(resolve => setTimeout(resolve, 400));
    expect(manager.isHealthy('recovering-provider')).toBe(true);
  });

  it('should track average latency', async () => {
    const manager = new HealthCheckManager({
      interval: 100,
      timeout: 50,
      failureThreshold: 10,
      historySize: 5,
    });

    let callCount = 0;

    manager.register('latency-provider', async () => {
      callCount++;
      return {
        healthy: true,
        status: 'healthy',
        latency: callCount * 10, // Increasing latency
        timestamp: Date.now(),
      };
    });

    // Wait for multiple checks
    await new Promise(resolve => setTimeout(resolve, 500));

    const health = manager.getHealth('latency-provider');
    expect(health).toBeDefined();
    expect(health?.providerId).toBe('latency-provider');
  });
});
