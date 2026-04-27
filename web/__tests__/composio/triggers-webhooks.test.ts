/**
 * Tests for Composio Triggers/Webhooks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// These modules don't exist yet — stub them so describe.skip doesn't crash at require()
vi.mock('@/lib/composio/session-manager', () => ({}));
vi.mock('@/lib/composio/webhook-handler', () => ({}));

describe.skip('Composio Triggers', () => {
  const { composioSessionManager } = require('@/lib/composio/session-manager');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTriggers', () => {
    it('should get triggers for user', async () => {
      const mockTriggers = [
        { id: 'trigger_1', name: 'GITHUB_COMMIT_EVENT' },
        { id: 'trigger_2', name: 'SLACK_MESSAGE_EVENT' },
      ];

      // Mock session
      const mockSession = {
        session: {
          triggers: {
            list: vi.fn().mockResolvedValue(mockTriggers),
          },
        },
      };

      // Mock getSession
      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      const triggers = await composioSessionManager.getTriggers('user_123');

      expect(triggers).toEqual(mockTriggers);
      expect(mockSession.session.triggers.list).toHaveBeenCalledWith({
        limit: 100,
      });
    });

    it('should filter triggers by toolkit', async () => {
      const mockSession = {
        session: {
          triggers: {
            list: vi.fn().mockResolvedValue([]),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      await composioSessionManager.getTriggers('user_123', { toolkit: 'GITHUB' });

      expect(mockSession.session.triggers.list).toHaveBeenCalledWith({
        toolkit: 'GITHUB',
        limit: 100,
      });
    });
  });

  describe('createTrigger', () => {
    it('should create trigger', async () => {
      const mockTrigger = { id: 'trigger_1', name: 'GITHUB_COMMIT_EVENT' };

      const mockSession = {
        session: {
          triggers: {
            getType: vi.fn().mockResolvedValue({ name: 'GITHUB_COMMIT_EVENT' }),
            create: vi.fn().mockResolvedValue(mockTrigger),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      const result = await composioSessionManager.createTrigger(
        'user_123',
        'GITHUB_COMMIT_EVENT',
        {
          config: { repo: 'user/repo' },
          webhookUrl: 'https://myapp.com/webhook',
        }
      );

      expect(result).toEqual(mockTrigger);
      expect(mockSession.session.triggers.create).toHaveBeenCalledWith({
        triggerName: 'GITHUB_COMMIT_EVENT',
        config: { repo: 'user/repo' },
        webhookUrl: 'https://myapp.com/webhook',
      });
    });
  });

  describe('subscribe', () => {
    it('should subscribe to trigger events', async () => {
      const mockUnsubscribe = vi.fn();
      const mockCallback = vi.fn();

      const mockSession = {
        session: {
          triggers: {
            subscribe: vi.fn().mockResolvedValue(mockUnsubscribe),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      const unsubscribe = await composioSessionManager.subscribe(
        'user_123',
        'GITHUB_COMMIT_EVENT',
        mockCallback
      );

      expect(unsubscribe).toBe(mockUnsubscribe);
      expect(mockSession.session.triggers.subscribe).toHaveBeenCalledWith(
        'GITHUB_COMMIT_EVENT',
        mockCallback
      );
    });
  });

  describe('deleteTrigger', () => {
    it('should delete trigger', async () => {
      const mockSession = {
        session: {
          triggers: {
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      await composioSessionManager.deleteTrigger('user_123', 'trigger_1');

      expect(mockSession.session.triggers.delete).toHaveBeenCalledWith({
        id: 'trigger_1',
      });
    });
  });

  describe('toggleTrigger', () => {
    it('should enable trigger', async () => {
      const mockSession = {
        session: {
          triggers: {
            enable: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      await composioSessionManager.toggleTrigger('user_123', 'trigger_1', true);

      expect(mockSession.session.triggers.enable).toHaveBeenCalledWith({
        id: 'trigger_1',
      });
    });

    it('should disable trigger', async () => {
      const mockSession = {
        session: {
          triggers: {
            disable: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      composioSessionManager.getSession = vi.fn().mockResolvedValue(mockSession);

      await composioSessionManager.toggleTrigger('user_123', 'trigger_1', false);

      expect(mockSession.session.triggers.disable).toHaveBeenCalledWith({
        id: 'trigger_1',
      });
    });
  });
});

describe.skip('Composio Webhook Handler', () => {
  const {
    verifyWebhookSignature,
    parseWebhookPayload,
    WebhookEventType,
  } = require('@/lib/composio/webhook-handler');

  describe('verifyWebhookSignature', () => {
    it('should verify valid signature', () => {
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'test-secret';
      
      // Create expected signature
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(payload);
      const expectedSignature = hmac.digest('hex');

      const isValid = verifyWebhookSignature(payload, expectedSignature, secret);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'test-secret';
      const invalidSignature = 'invalid-signature';

      const isValid = verifyWebhookSignature(payload, invalidSignature, secret);
      expect(isValid).toBe(false);
    });
  });

  describe('parseWebhookPayload', () => {
    it('should parse valid payload', () => {
      const payload = JSON.stringify({
        event_type: 'TRIGGER_MESSAGE',
        metadata: {
          trigger_id: 'trigger_1',
          trigger_slug: 'GITHUB_COMMIT_EVENT',
          trigger_name: 'GitHub Commit',
          connected_account_id: 'account_1',
          app_name: 'GitHub',
          app_slug: 'github',
        },
        data: { commit: 'abc123' },
        original_payload: {},
      });

      const parsed = parseWebhookPayload(payload);
      expect(parsed.event_type).toBe('TRIGGER_MESSAGE');
      expect(parsed.metadata.trigger_slug).toBe('GITHUB_COMMIT_EVENT');
    });

    it('should reject invalid payload', () => {
      const invalidPayload = JSON.stringify({ invalid: 'structure' });

      expect(() => parseWebhookPayload(invalidPayload)).toThrow();
    });
  });

  describe('WebhookEventType', () => {
    it('should have correct event types', () => {
      expect(WebhookEventType.TRIGGER_MESSAGE).toBe('TRIGGER_MESSAGE');
      expect(WebhookEventType.TRIGGER_STATE).toBe('TRIGGER_STATE');
      expect(WebhookEventType.ACCOUNT_CONNECTED).toBe('ACCOUNT_CONNECTED');
      expect(WebhookEventType.ACCOUNT_DISCONNECTED).toBe('ACCOUNT_DISCONNECTED');
    });
  });
});
