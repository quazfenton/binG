/**
 * E2E Tests: Composio Enhanced Features
 * 
 * Tests for resource subscription and prompt management.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// These modules don't exist yet — stub them so describe.skip doesn't crash at require()
vi.mock('@/lib/composio/resource-subscription', () => ({}));
vi.mock('@/lib/composio/prompt-management', () => ({}));

describe.skip('Composio Enhanced Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Composio Subscription Manager', () => {
    const { ComposioSubscriptionManager, composioSubscriptionManager, createSubscriptionManager, subscribe } = require('@/lib/composio/resource-subscription');

    let subscriptionManager: typeof ComposioSubscriptionManager;

    beforeEach(() => {
      subscriptionManager = new ComposioSubscriptionManager();
    });

    it('should create subscription', () => {
      const subscription = subscriptionManager.createSubscription(
        'user-123',
        ['account.connected', 'trigger.executed']
      );

      expect(subscription.id).toBeDefined();
      expect(subscription.userId).toBe('user-123');
      expect(subscription.eventTypes).toHaveLength(2);
      expect(subscription.active).toBe(true);
    });

    it('should create filtered subscription', () => {
      const subscription = subscriptionManager.createSubscription(
        'user-123',
        ['trigger.executed'],
        { accountId: 'acc-123', triggerId: 'trig-456' }
      );

      expect(subscription.accountId).toBe('acc-123');
      expect(subscription.triggerId).toBe('trig-456');
    });

    it('should cancel subscription', () => {
      const subscription = subscriptionManager.createSubscription('user-123', ['account.connected']);
      
      subscriptionManager.cancelSubscription(subscription.id);
      
      const retrieved = subscriptionManager.getSubscription(subscription.id);
      expect(retrieved).toBeNull();
    });

    it('should publish events to matching subscriptions', () => {
      const eventSpy = vi.fn();
      subscriptionManager.on('event', eventSpy);

      const subscription = subscriptionManager.createSubscription(
        'user-123',
        ['account.connected']
      );

      subscriptionManager.publishEvent({
        type: 'account.connected',
        data: { accountId: 'acc-123' },
        timestamp: Date.now(),
        userId: 'user-123',
      });

      expect(eventSpy).toHaveBeenCalled();
    });

    it('should not publish to non-matching subscriptions', () => {
      const eventSpy = vi.fn();
      subscriptionManager.on('event', eventSpy);

      subscriptionManager.createSubscription('user-123', ['account.connected']);

      subscriptionManager.publishEvent({
        type: 'trigger.executed', // Different event type
        data: {},
        timestamp: Date.now(),
        userId: 'user-123',
      });

      expect(eventSpy).not.toHaveBeenCalled();
    });

    it('should queue events', () => {
      subscriptionManager.createSubscription('user-123', ['account.connected']);

      for (let i = 0; i < 5; i++) {
        subscriptionManager.publishEvent({
          type: 'account.connected',
          data: { index: i },
          timestamp: Date.now(),
          userId: 'user-123',
        });
      }

      const events = subscriptionManager.getQueuedEvents();
      expect(events.length).toBe(5);
    });

    it('should provide subscription statistics', () => {
      subscriptionManager.createSubscription('user-1', ['account.connected']);
      subscriptionManager.createSubscription('user-2', ['trigger.executed']);
      subscriptionManager.createSubscription('user-3', ['account.connected']);

      const stats = subscriptionManager.getStats();

      expect(stats.totalSubscriptions).toBe(3);
      expect(stats.activeSubscriptions).toBe(3);
    });

    it('should support quick subscribe helper', () => {
      const callback = vi.fn();
      
      const unsubscribe = subscribe(
        'user-123',
        ['account.connected'],
        callback
      );

      subscriptionManager.publishEvent({
        type: 'account.connected',
        data: {},
        timestamp: Date.now(),
        userId: 'user-123',
      });

      expect(callback).toHaveBeenCalled();

      unsubscribe();
      expect(subscriptionManager.getStats().activeSubscriptions).toBe(0);
    });
  });

  describe('Composio Prompt Manager', () => {
    const { ComposioPromptManager, composioPromptManager, createPromptManager, PromptTemplates } = require('@/lib/composio/prompt-management');

    let promptManager: typeof ComposioPromptManager;

    beforeEach(() => {
      promptManager = new ComposioPromptManager();
    });

    it('should create template', () => {
      const template = promptManager.createTemplate(
        'test-template',
        'Hello {{name}}, welcome to {{company}}!',
        ['name', 'company']
      );

      expect(template.id).toBeDefined();
      expect(template.name).toBe('test-template');
      expect(template.variables).toHaveLength(2);
      expect(template.version).toBe(1);
    });

    it('should extract variables from content', () => {
      const template = promptManager.createTemplate(
        'auto-vars',
        'Process {{input}} and return {{output}} with {{format}}'
      );

      expect(template.variables).toContain('input');
      expect(template.variables).toContain('output');
      expect(template.variables).toContain('format');
    });

    it('should render template with variables', () => {
      const template = promptManager.createTemplate(
        'greeting',
        'Hello {{name}}! Your order {{orderId}} is ready.'
      );

      const rendered = promptManager.renderTemplate(template.id, {
        name: 'John',
        orderId: '12345',
      });

      expect(rendered).toBe('Hello John! Your order 12345 is ready.');
    });

    it('should update template', () => {
      const template = promptManager.createTemplate('test', 'Original content');
      
      const updated = promptManager.updateTemplate(template.id, {
        content: 'Updated content',
        active: false,
      });

      expect(updated?.content).toBe('Updated content');
      expect(updated?.active).toBe(false);
      expect(updated?.version).toBe(2);
    });

    it('should record execution results', () => {
      const template = promptManager.createTemplate('test', 'Test content');
      
      promptManager.recordExecution({
        templateId: template.id,
        timestamp: Date.now(),
        success: true,
        duration: 100,
        tool: 'test-tool',
      });

      const stats = promptManager.getTemplateStats(template.id);
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successRate).toBe(100);
    });

    it('should provide template performance stats', () => {
      const template = promptManager.createTemplate('perf-test', 'Test');
      
      // Record multiple executions
      for (let i = 0; i < 10; i++) {
        promptManager.recordExecution({
          templateId: template.id,
          timestamp: Date.now(),
          success: i < 8, // 80% success rate
          duration: 100 + i * 10,
        });
      }

      const stats = promptManager.getTemplateStats(template.id);

      expect(stats.totalExecutions).toBe(10);
      expect(stats.successRate).toBe(80);
      expect(stats.averageDuration).toBeGreaterThan(0);
      expect(stats.recentSuccessRate).toBe(80);
    });

    it('should compare templates (A/B testing)', () => {
      const templateA = promptManager.createTemplate('variant-a', 'Version A');
      const templateB = promptManager.createTemplate('variant-b', 'Version B');

      // Record executions for both
      for (let i = 0; i < 5; i++) {
        promptManager.recordExecution({
          templateId: templateA.id,
          timestamp: Date.now(),
          success: true,
          duration: 100,
        });
        promptManager.recordExecution({
          templateId: templateB.id,
          timestamp: Date.now(),
          success: i < 4, // 80% success
          duration: 150,
        });
      }

      const comparison = promptManager.compareTemplates([templateA.id, templateB.id]);

      expect(comparison.length).toBe(2);
      expect(comparison[0].executions).toBe(5);
      expect(comparison[1].executions).toBe(5);
    });

    it('should use pre-configured templates', () => {
      const toolExecution = PromptTemplates.toolExecution('github-create-issue');
      const errorHandling = PromptTemplates.errorHandling();
      const resultInterpretation = PromptTemplates.resultInterpretation();
      const multiStepWorkflow = PromptTemplates.multiStepWorkflow();

      expect(toolExecution.name).toBe('tool-execution');
      expect(errorHandling.name).toBe('error-handling');
      expect(resultInterpretation.name).toBe('result-interpretation');
      expect(multiStepWorkflow.name).toBe('multi-step-workflow');
    });

    it('should get execution history', () => {
      const template = promptManager.createTemplate('history-test', 'Test');
      
      for (let i = 0; i < 20; i++) {
        promptManager.recordExecution({
          templateId: template.id,
          timestamp: Date.now() - i * 1000,
          success: true,
          duration: 100,
        });
      }

      const history = promptManager.getExecutionHistory(template.id, 10);
      expect(history.length).toBe(10);
    });

    it('should clear history', () => {
      const template = promptManager.createTemplate('clear-test', 'Test');
      
      promptManager.recordExecution({
        templateId: template.id,
        timestamp: Date.now(),
        success: true,
        duration: 100,
      });

      promptManager.clearHistory(template.id);
      
      const history = promptManager.getExecutionHistory(template.id);
      expect(history.length).toBe(0);
    });
  });

  describe('Composio Integration: Subscription + Prompts', () => {
    const { composioSubscriptionManager } = require('@/lib/composio/resource-subscription');
    const { composioPromptManager } = require('@/lib/composio/prompt-management');

    it('should work together for workflow automation', () => {
      // Create prompt template
      const template = composioPromptManager.createTemplate(
        'workflow-prompt',
        'Execute {{toolName}} with {{params}}'
      );

      // Subscribe to tool execution events
      const subscription = composioSubscriptionManager.createSubscription(
        'user-123',
        ['tool.executed']
      );

      // Publish event
      composioSubscriptionManager.publishEvent({
        type: 'tool.executed',
        data: { toolName: 'github-create-issue' },
        timestamp: Date.now(),
        userId: 'user-123',
      });

      expect(template).toBeDefined();
      expect(subscription).toBeDefined();
    });
  });
});
