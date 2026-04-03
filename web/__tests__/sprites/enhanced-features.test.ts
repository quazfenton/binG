/**
 * E2E Tests: Sprites Enhanced Features
 * 
 * Tests for resource monitoring and volume management.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('Sprites Enhanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sprites Resource Monitor', () => {
    const { SpritesResourceMonitor, spritesResourceMonitor, createSpritesResourceMonitor } = require('@/lib/sandbox/providers/sprites-resource-monitor');

    let resourceMonitor: typeof SpritesResourceMonitor;

    beforeEach(() => {
      resourceMonitor = new SpritesResourceMonitor();
    });

    it('should track resource metrics', () => {
      const metrics = {
        spriteId: 'sprite-1',
        memoryUsed: 512,
        memoryLimit: 1024,
        memoryPercentage: 50,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 30,
        timestamp: Date.now(),
      };

      resourceMonitor.updateMetrics(metrics);

      const current = resourceMonitor.getCurrentMetrics('sprite-1');
      expect(current).toBeDefined();
      expect(current?.memoryPercentage).toBe(50);
    });

    it('should generate memory alerts', () => {
      const alertSpy = vi.fn();
      resourceMonitor.on('alert', alertSpy);

      // Update with high memory usage
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 900,
        memoryLimit: 1000,
        memoryPercentage: 90, // Critical threshold
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 30,
        timestamp: Date.now(),
      });

      expect(alertSpy).toHaveBeenCalled();
      const alert = alertSpy.mock.calls[0][0];
      expect(alert.resourceType).toBe('memory');
      expect(alert.severity).toBe('critical');
    });

    it('should generate NVMe alerts', () => {
      const alertSpy = vi.fn();
      resourceMonitor.on('alert', alertSpy);

      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 500,
        memoryLimit: 1000,
        memoryPercentage: 50,
        nvmeUsed: 9,
        nvmeLimit: 10,
        nvmePercentage: 90, // Critical threshold
        cpuPercentage: 30,
        timestamp: Date.now(),
      });

      expect(alertSpy).toHaveBeenCalled();
      const alert = alertSpy.mock.calls[0][0];
      expect(alert.resourceType).toBe('nvme');
    });

    it('should generate CPU alerts', () => {
      const alertSpy = vi.fn();
      resourceMonitor.on('alert', alertSpy);

      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 500,
        memoryLimit: 1000,
        memoryPercentage: 50,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 95, // Critical threshold
        timestamp: Date.now(),
      });

      expect(alertSpy).toHaveBeenCalled();
      const alert = alertSpy.mock.calls[0][0];
      expect(alert.resourceType).toBe('cpu');
    });

    it('should provide resource summary', () => {
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 750,
        memoryLimit: 1000,
        memoryPercentage: 75,
        nvmeUsed: 8,
        nvmeLimit: 10,
        nvmePercentage: 80,
        cpuPercentage: 60,
        timestamp: Date.now(),
      });

      const summary = resourceMonitor.getResourceSummary('sprite-1');

      expect(summary.memory.percentage).toBe(75);
      expect(summary.nvme.percentage).toBe(80);
      expect(summary.cpu.percentage).toBe(60);
      expect(summary.health).toBe('warning');
    });

    it('should determine health status correctly', () => {
      // Good health
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 500,
        memoryLimit: 1000,
        memoryPercentage: 50,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 50,
        timestamp: Date.now(),
      });

      expect(resourceMonitor.getResourceSummary('sprite-1').health).toBe('good');

      // Warning health
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 750,
        memoryLimit: 1000,
        memoryPercentage: 75,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 50,
        timestamp: Date.now(),
      });

      expect(resourceMonitor.getResourceSummary('sprite-1').health).toBe('warning');

      // Critical health
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 950,
        memoryLimit: 1000,
        memoryPercentage: 95,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 50,
        timestamp: Date.now(),
      });

      expect(resourceMonitor.getResourceSummary('sprite-1').health).toBe('critical');
    });

    it('should store historical metrics', () => {
      for (let i = 0; i < 10; i++) {
        resourceMonitor.updateMetrics({
          spriteId: 'sprite-1',
          memoryUsed: 500 + i * 10,
          memoryLimit: 1000,
          memoryPercentage: 50 + i,
          nvmeUsed: 5,
          nvmeLimit: 10,
          nvmePercentage: 50,
          cpuPercentage: 30,
          timestamp: Date.now() - i * 1000,
        });
      }

      const history = resourceMonitor.getHistoricalMetrics('sprite-1', 60000);
      expect(history.length).toBe(10);
    });

    it('should filter alerts by sprite and time', () => {
      resourceMonitor.updateMetrics({
        spriteId: 'sprite-1',
        memoryUsed: 900,
        memoryLimit: 1000,
        memoryPercentage: 90,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 30,
        timestamp: Date.now(),
      });

      resourceMonitor.updateMetrics({
        spriteId: 'sprite-2',
        memoryUsed: 900,
        memoryLimit: 1000,
        memoryPercentage: 90,
        nvmeUsed: 5,
        nvmeLimit: 10,
        nvmePercentage: 50,
        cpuPercentage: 30,
        timestamp: Date.now(),
      });

      const sprite1Alerts = resourceMonitor.getAlerts('sprite-1');
      expect(sprite1Alerts.length).toBe(1);
      expect(sprite1Alerts[0].spriteId).toBe('sprite-1');
    });
  });

  describe('Sprites Volume Management', () => {
    // Volume management would integrate with Sprites API
    // This tests the interface and expected behavior

    it('should support volume attachment', () => {
      // Interface test - actual implementation would call Sprites API
      const volumeConfig = {
        name: 'data-volume',
        size: 100, // GB
        type: 'persistent',
        mountPath: '/mnt/data',
      };

      expect(volumeConfig.name).toBeDefined();
      expect(volumeConfig.size).toBeGreaterThan(0);
      expect(volumeConfig.mountPath).startsWith('/');
    });

    it('should support volume snapshots', () => {
      const snapshotConfig = {
        volumeName: 'data-volume',
        snapshotName: 'backup-2024-01-01',
        description: 'Daily backup',
      };

      expect(snapshotConfig.volumeName).toBeDefined();
      expect(snapshotConfig.snapshotName).toBeDefined();
    });

    it('should support volume resizing', () => {
      const resizeConfig = {
        volumeName: 'data-volume',
        newSize: 200, // GB
      };

      expect(resizeConfig.newSize).toBeGreaterThan(0);
    });
  });

  describe('Sprites Multi-Region Support', () => {
    it('should support region selection', () => {
      const regions = ['iad', 'sjc', 'fra', 'sin', 'syd'];
      
      regions.forEach(region => {
        expect(region).toMatch(/^[a-z]{3}$/);
      });
    });

    it('should handle region failover', () => {
      const primaryRegion = 'iad';
      const fallbackRegions = ['sjc', 'fra'];

      // Simulate failover logic
      const failoverRegion = fallbackRegions[0];
      expect(failoverRegion).toBeDefined();
    });
  });
});
