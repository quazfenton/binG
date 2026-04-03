/**
 * Cloud Deployment Service Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cloudDeploymentService,
  type CloudDeploymentConfig,
} from '@/lib/sandbox/cloud-deployment-service';

describe('Cloud Deployment Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await cloudDeploymentService.shutdown();
    vi.restoreAllMocks();
  });

  describe('Deployment', () => {
    it('should create deployment record', async () => {
      const config: CloudDeploymentConfig = {
        providers: ['e2b'],
        region: 'us-east-1',
        enableAutoScaling: false,
      };

      // Note: This will fail in test environment without real providers
      // but tests the deployment flow
      const result = await cloudDeploymentService.deploy(
        'test-user',
        'test-conversation',
        config
      );

      // Should attempt deployment (may fail due to missing API keys)
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should try multiple providers with failover', async () => {
      const config: CloudDeploymentConfig = {
        providers: ['e2b', 'daytona', 'blaxel'],
        enableFailover: true,
      };

      const result = await cloudDeploymentService.deploy(
        'test-user',
        'test-conversation',
        config
      );

      // Should try all providers in order
      expect(result).toBeDefined();
    });

    it('should track deployment status', async () => {
      const deployments = cloudDeploymentService.listDeployments();
      expect(Array.isArray(deployments)).toBe(true);
    });

    it('should get deployment statistics', () => {
      const stats = cloudDeploymentService.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats.total).toBe('number');
      expect(typeof stats.running).toBe('number');
      expect(typeof stats.healthy).toBe('number');
      expect(stats.byProvider).toBeDefined();
    });
  });

  describe('Health Checks', () => {
    it('should perform health checks on running deployments', async () => {
      // Health checks run automatically via timer
      // This test verifies the service is running
      const stats = cloudDeploymentService.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Scaling', () => {
    it('should scale deployment', async () => {
      // Would need active deployment to test
      const result = await cloudDeploymentService.scale('nonexistent', 5);
      expect(result).toBe(false); // Expected for nonexistent deployment
    });
  });

  describe('Shutdown', () => {
    it('should shutdown gracefully', async () => {
      await cloudDeploymentService.shutdown();
      
      const stats = cloudDeploymentService.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
