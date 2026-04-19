/**
 * Tests for Nango Sync Management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Nango Sync Management', () => {
  const { NangoService, createNangoService } = require('@/lib/integrations/nango-service');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startSync', () => {
    it('should start sync', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          start: vi.fn().mockResolvedValue({ jobId: 'job_123' }),
        },
      };

      const result = await service.startSync('user_123', 'github', 'issues-sync');

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job_123');
    });

    it('should handle sync start failure', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          start: vi.fn().mockRejectedValue(new Error('Sync not found')),
        },
      };

      const result = await service.startSync('user_123', 'github', 'invalid-sync');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sync not found');
    });
  });

  describe('getSyncStatus', () => {
    it('should get sync status', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          status: vi.fn().mockResolvedValue({
            status: 'RUNNING',
            last_sync_date: '2024-01-01T00:00:00Z',
          }),
        },
      };

      const result = await service.getSyncStatus('user_123', 'github', 'issues-sync');

      expect(result.status).toBe('RUNNING');
      expect(result.lastSyncDate).toBeDefined();
    });

    it('should handle stopped sync', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          status: vi.fn().mockResolvedValue({
            status: 'STOPPED',
            error: 'Connection lost',
          }),
        },
      };

      const result = await service.getSyncStatus('user_123', 'github', 'issues-sync');

      expect(result.status).toBe('STOPPED');
      expect(result.error).toBe('Connection lost');
    });
  });

  describe('executeAction', () => {
    it('should execute action', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        action: {
          run: vi.fn().mockResolvedValue({
            success: true,
            data: { id: 'issue_123' },
          }),
        },
      };

      const result = await service.executeAction(
        'user_123',
        'github',
        'create_issue',
        { title: 'Bug', body: 'Description' }
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'issue_123' });
    });

    it('should handle action failure', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        action: {
          run: vi.fn().mockRejectedValue(new Error('Action failed')),
        },
      };

      const result = await service.executeAction(
        'user_123',
        'github',
        'create_issue',
        { title: 'Bug' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Action failed');
    });
  });

  describe('getConnectedAccounts', () => {
    it('should get connected accounts', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        listConnections: vi.fn().mockResolvedValue([
          { id: 'conn_1', provider: 'github', connection_id: 'user_123' },
          { id: 'conn_2', provider: 'slack', connection_id: 'user_123' },
        ]),
      };

      const accounts = await service.getConnectedAccounts('user_123');

      expect(accounts).toHaveLength(2);
      expect(accounts[0].provider).toBe('github');
    });
  });

  describe('createConnection', () => {
    it('should create connection with redirect URL', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          initiateConnection: vi.fn().mockResolvedValue({
            redirectUrl: 'https://github.com/oauth/authorize',
            id: 'conn_1',
          }),
        },
      };

      const result = await service.createConnection('user_123', 'github');

      expect(result.redirectUrl).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('should create immediate connection for API key', async () => {
      const service = createNangoService({ secretKey: 'test_key' });

      service.client = {
        sync: {
          initiateConnection: vi.fn().mockResolvedValue({
            id: 'conn_1',
          }),
        },
      };

      const result = await service.createConnection('user_123', 'github', 'API_KEY');

      expect(result.connectionId).toBe('conn_1');
      expect(result.status).toBe('active');
    });
  });
});
