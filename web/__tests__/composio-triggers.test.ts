/**
 * Composio Triggers Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createComposioTriggersService } from '../lib/integrations/composio/composio-triggers';

describe('Composio Triggers Service', () => {
  let triggersService: ReturnType<typeof createComposioTriggersService>;

  beforeEach(() => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-composio-key');
    vi.stubEnv('COMPOSIO_WEBHOOK_SECRET', 'test-webhook-secret');
    triggersService = createComposioTriggersService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('listAvailableTriggers', () => {
    it('should list all triggers', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { name: 'github-issue-created', toolkit: 'github' },
          { name: 'slack-message', toolkit: 'slack' },
        ]),
      });

      const triggers = await triggersService.listAvailableTriggers();

      expect(triggers.length).toBe(2);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/triggers'),
        expect.any(Object)
      );
    });

    it('should filter by toolkit', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await triggersService.listAvailableTriggers({ toolkit: 'github' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('toolkit=github'),
        expect.any(Object)
      );
    });

    it('should limit results', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await triggersService.listAvailableTriggers({ limit: 10 });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=10'),
        expect.any(Object)
      );
    });
  });

  describe('createTrigger', () => {
    it('should create new trigger', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'trigger-123',
          name: 'github-issue',
          toolkit: 'github',
          status: 'active',
        }),
      });

      const trigger = await triggersService.createTrigger({
        name: 'github-issue',
        toolkit: 'github',
        config: { repo: 'myorg/myrepo' },
        webhookUrl: 'https://myapp.com/webhook',
      });

      expect(trigger.id).toBe('trigger-123');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/triggers'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.any(Object),
        })
      );
    });

    it('should include filters in config', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'trigger-1' }),
      });

      await triggersService.createTrigger({
        name: 'test-trigger',
        toolkit: 'github',
        filters: { event: 'issues.opened' },
      });

      expect(fetch).toHaveBeenCalled();
    });
  });

  describe('getTrigger', () => {
    it('should get trigger details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'trigger-123',
          name: 'github-issue',
          status: 'active',
          triggerCount: 10,
        }),
      });

      const trigger = await triggersService.getTrigger('trigger-123');

      expect(trigger.id).toBe('trigger-123');
      expect(trigger.triggerCount).toBe(10);
    });

    it('should handle trigger not found', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(triggersService.getTrigger('invalid'))
        .rejects.toThrow('Failed to get trigger');
    });
  });

  describe('updateTrigger', () => {
    it('should update trigger config', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'trigger-123', status: 'active' }),
      });

      const trigger = await triggersService.updateTrigger('trigger-123', {
        config: { repo: 'neworg/newrepo' },
      });

      expect(trigger.id).toBe('trigger-123');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/triggers/trigger-123'),
        expect.objectContaining({ method: 'PATCH' })
      );
    });
  });

  describe('activateTrigger', () => {
    it('should activate trigger', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'trigger-123', status: 'active' }),
      });

      const trigger = await triggersService.activateTrigger('trigger-123');

      expect(trigger.status).toBe('active');
    });
  });

  describe('deactivateTrigger', () => {
    it('should deactivate trigger', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'trigger-123', status: 'inactive' }),
      });

      const trigger = await triggersService.deactivateTrigger('trigger-123');

      expect(trigger.status).toBe('inactive');
    });
  });

  describe('deleteTrigger', () => {
    it('should delete trigger', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      await triggersService.deleteTrigger('trigger-123');

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/triggers/trigger-123'),
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  describe('listExecutions', () => {
    it('should list trigger executions', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([
          { id: 'exec-1', status: 'success', startedAt: '2024-01-01' },
          { id: 'exec-2', status: 'failed', startedAt: '2024-01-02' },
        ]),
      });

      const executions = await triggersService.listExecutions('trigger-123');

      expect(executions.length).toBe(2);
      expect(executions[0].status).toBe('success');
    });

    it('should filter by status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await triggersService.listExecutions('trigger-123', { status: 'failed' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=failed'),
        expect.any(Object)
      );
    });

    it('should limit results', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ([]),
      });

      await triggersService.listExecutions('trigger-123', { limit: 5 });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.any(Object)
      );
    });
  });

  describe('getExecution', () => {
    it('should get execution details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'exec-123',
          status: 'success',
          input: { data: 'test' },
          output: { result: 'success' },
          durationMs: 1500,
        }),
      });

      const execution = await triggersService.getExecution('trigger-123', 'exec-123');

      expect(execution.id).toBe('exec-123');
      expect(execution.durationMs).toBe(1500);
    });
  });

  describe('retryExecution', () => {
    it('should retry failed execution', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'exec-123', status: 'running' }),
      });

      const execution = await triggersService.retryExecution('trigger-123', 'exec-123');

      expect(execution.status).toBe('running');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/executions/exec-123/retry'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('getStats', () => {
    it('should get trigger statistics', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          totalExecutions: 100,
          successfulExecutions: 95,
          failedExecutions: 5,
          averageDurationMs: 1200,
          lastTriggeredAt: '2024-01-15',
        }),
      });

      const stats = await triggersService.getStats('trigger-123');

      expect(stats.totalExecutions).toBe(100);
      expect(stats.successfulExecutions).toBe(95);
      expect(stats.averageDurationMs).toBe(1200);
    });
  });

  describe('handleWebhook', () => {
    it('should parse webhook event', async () => {
      const webhookBody = {
        trigger_id: 'trigger-123',
        trigger_name: 'github-issue',
        toolkit: 'github',
        payload: { issue: { number: 1 } },
      };

      const headers = {
        'content-type': 'application/json',
      };

      const event = await triggersService.handleWebhook(webhookBody, headers);

      expect(event).not.toBeNull();
      expect(event?.triggerId).toBe('trigger-123');
      expect(event?.payload).toEqual({ issue: { number: 1 } });
    });

    it('should return null for invalid webhook', async () => {
      const event = await triggersService.handleWebhook(
        { invalid: 'data' },
        {}
      );

      expect(event).toBeNull();
    });

    it('should verify webhook signature', async () => {
      const crypto = await import('node:crypto');
      const secret = 'test-webhook-secret';

      // Set the webhook secret env var
      vi.stubEnv('COMPOSIO_WEBHOOK_SECRET', secret);

      const payload = { 
        trigger_id: 'trigger-123',
        trigger_name: 'github-issue-created',
        toolkit: 'github'
      };
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      const event = await triggersService.handleWebhook(payload, {
        'x-composio-signature': signature,
      });

      expect(event).not.toBeNull();
      expect(event?.triggerId).toBe('trigger-123');
      vi.unstubAllEnvs();
    });

    it('should reject invalid signature', async () => {
      const payload = { trigger_id: 'trigger-123' };

      await expect(
        triggersService.handleWebhook(payload, {
          'x-composio-signature': 'invalid-signature',
        })
      ).rejects.toThrow('Invalid webhook signature');
    });
  });

  describe('subscribe', () => {
    it('should subscribe to trigger events', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 'exec-1', status: 'success', startedAt: '2024-01-01', input: {} },
          ]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([
            { id: 'exec-2', status: 'success', startedAt: '2024-01-02', input: {} },
          ]),
        });

      const callback = vi.fn();
      const unsubscribe = await triggersService.subscribe('trigger-123', callback, {
        pollIntervalMs: 100,
      });

      // Wait for first poll
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(callback).toHaveBeenCalled();

      // Cleanup
      unsubscribe();
    });

    it('should call onError on polling failure', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const onError = vi.fn();
      const unsubscribe = await triggersService.subscribe('trigger-123', () => {}, {
        pollIntervalMs: 50,
        onError,
      });

      // Wait for first poll
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(onError).toHaveBeenCalled();

      unsubscribe();
    });
  });
});
