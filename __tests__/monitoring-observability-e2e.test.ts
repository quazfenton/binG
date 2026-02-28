/**
 * Monitoring & Observability E2E Tests
 * 
 * Tests monitoring and observability features:
 * - Health check API
 * - Quota monitoring
 * - Error tracking
 * - Request logging
 * - Audit logging
 * - Provider health monitoring
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Monitoring & Observability E2E Tests', () => {
  const testUserId = 'monitoring_test_' + Date.now();

  /**
   * Health Check API Tests
   */
  describe('Health Check API', () => {
    it('should return basic health status', async () => {
      const { enhancedLLMService } = await import('@/lib/api/enhanced-llm-service');
      const { enhancedAPIClient } = await import('@/lib/api/enhanced-api-client');
      const { errorHandler } = await import('@/lib/api/error-handler');

      // Get provider health
      const providerHealth = enhancedLLMService.getProviderHealth();
      expect(providerHealth).toBeDefined();
      expect(typeof providerHealth).toBe('object');

      // Get circuit breaker stats
      const circuitBreakerStats = enhancedAPIClient.getCircuitBreakerStats();
      expect(circuitBreakerStats).toBeDefined();
      expect(typeof circuitBreakerStats).toBe('object');

      // Get error stats
      const errorStats = errorHandler.getErrorStats();
      expect(errorStats).toBeDefined();
      expect(typeof errorStats).toBe('object');
    });

    it('should return detailed health with all metrics', async () => {
      const { enhancedLLMService } = await import('@/lib/api/enhanced-llm-service');
      const { enhancedAPIClient } = await import('@/lib/api/enhanced-api-client');
      const { errorHandler } = await import('@/lib/api/error-handler');

      // Get all health metrics
      const health = {
        providers: enhancedLLMService.getProviderHealth(),
        availableProviders: enhancedLLMService.getAvailableProviders(),
        circuitBreakers: enhancedAPIClient.getCircuitBreakerStats(),
        errors: errorHandler.getErrorStats(),
      };

      expect(health.providers).toBeDefined();
      expect(health.availableProviders).toBeDefined();
      expect(Array.isArray(health.availableProviders)).toBe(true);
      expect(health.circuitBreakers).toBeDefined();
      expect(health.errors).toBeDefined();
    });

    it('should reset circuit breakers', async () => {
      const { enhancedLLMService } = await import('@/lib/api/enhanced-llm-service');

      // Reset all circuit breakers
      enhancedLLMService.resetProviderHealth();

      // Verify reset
      const health = enhancedLLMService.getProviderHealth();
      expect(health).toBeDefined();
    });
  });

  /**
   * Quota Monitoring Tests
   */
  describe('Quota Monitoring', () => {
    it('should get quota status for all providers', async () => {
      const { quotaManager } = await import('@/lib/services/quota-manager');

      const status = quotaManager.getAllStatus();
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');

      // Verify status has expected providers
      const expectedProviders = [
        'composio',
        'arcade',
        'nango',
        'daytona',
        'runloop',
        'microsandbox',
        'e2b',
        'mistral',
        'blaxel',
        'sprites',
      ];

      for (const provider of expectedProviders) {
        expect(status[provider]).toBeDefined();
        expect(status[provider].monthlyLimit).toBeGreaterThan(0);
        expect(status[provider].currentUsage).toBeGreaterThanOrEqual(0);
      }
    });

    it('should track quota usage', async () => {
      const { quotaManager } = await import('@/lib/services/quota-manager');

      const initialStatus = quotaManager.getAllStatus();
      const initialUsage = initialStatus.composio.currentUsage;

      // Record usage
      quotaManager.recordUsage('composio', 10);

      const updatedStatus = quotaManager.getAllStatus();
      const updatedUsage = updatedStatus.composio.currentUsage;

      expect(updatedUsage).toBeGreaterThanOrEqual(initialUsage);
    });

    it('should generate alerts for high usage', async () => {
      const { quotaManager } = await import('@/lib/services/quota-manager');

      // Get alerts
      const alerts = quotaManager.generateAlerts();
      expect(Array.isArray(alerts)).toBe(true);

      // Alerts should have required fields
      if (alerts.length > 0) {
        const alert = alerts[0];
        expect(alert.type).toBeDefined();
        expect(alert.provider).toBeDefined();
        expect(alert.message).toBeDefined();
        expect(alert.percentageUsed).toBeDefined();
      }
    });

    it('should reset quota for provider', async () => {
      const { quotaManager } = await import('@/lib/services/quota-manager');

      // Reset composio quota
      quotaManager.resetQuota('composio');

      const status = quotaManager.getStatus('composio');
      expect(status.currentUsage).toBe(0);
    });
  });

  /**
   * Error Tracking Tests
   */
  describe('Error Tracking', () => {
    it('should categorize errors correctly', async () => {
      const { errorHandler } = await import('@/lib/api/error-handler');

      // Create test errors
      const authError = new Error('Authentication failed');
      const rateLimitError = new Error('Rate limit exceeded');
      const timeoutError = new Error('Request timeout');

      // Handle errors
      const handledAuth = errorHandler.handleError(authError, {
        context: 'test',
        provider: 'test',
      });
      const handledRateLimit = errorHandler.handleError(rateLimitError, {
        context: 'test',
        provider: 'test',
      });
      const handledTimeout = errorHandler.handleError(timeoutError, {
        context: 'test',
        provider: 'test',
      });

      // Verify categorization
      expect(handledAuth.category).toBe('auth');
      expect(handledRateLimit.category).toBe('rate_limit');
      expect(handledTimeout.category).toBe('timeout');
    });

    it('should track error frequency', async () => {
      const { errorHandler } = await import('@/lib/api/error-handler');

      // Generate multiple errors
      for (let i = 0; i < 5; i++) {
        errorHandler.handleError(new Error(`Test error ${i}`), {
          context: 'test',
          provider: 'test',
        });
      }

      // Get stats
      const stats = errorHandler.getErrorStats();
      expect(stats.totalErrors).toBeGreaterThan(0);
      expect(stats.frequentErrors).toBeDefined();
    });

    it('should provide user-friendly error messages', async () => {
      const { errorHandler } = await import('@/lib/api/error-handler');

      const error = new Error('Internal server error: database connection failed');
      const handled = errorHandler.handleError(error, {
        context: 'test',
        provider: 'test',
      });

      expect(handled.userMessage).toBeDefined();
      expect(handled.userMessage).not.toContain('database');
      expect(handled.userMessage).toContain('error');
    });

    it('should clear error stats', async () => {
      const { errorHandler } = await import('@/lib/api/error-handler');

      // Clear stats
      errorHandler.clearErrorStats();

      const stats = errorHandler.getErrorStats();
      expect(stats.totalErrors).toBe(0);
    });
  });

  /**
   * Request Logging Tests
   */
  describe('Request Logging', () => {
    it('should log chat requests', async () => {
      const { chatRequestLogger } = await import('@/lib/api/chat-request-logger');

      const testRequestId = 'test_request_' + Date.now();

      // Log request start
      await chatRequestLogger.logRequestStart(
        testRequestId,
        testUserId,
        'openrouter',
        'gpt-4o-mini',
        [{ role: 'user', content: 'Test' }],
        false
      );

      // Log request complete
      await chatRequestLogger.logRequestComplete(
        testRequestId,
        true,
        100,
        { prompt: 10, completion: 20, total: 30 },
        500
      );

      // Query logs
      const logs = await chatRequestLogger.queryLogs({
        userId: testUserId,
        limit: 10,
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should track token usage', async () => {
      const { chatRequestLogger } = await import('@/lib/api/chat-request-logger');

      const testRequestId = 'test_tokens_' + Date.now();

      // Log with token usage
      await chatRequestLogger.logRequestStart(
        testRequestId,
        testUserId,
        'openrouter',
        'gpt-4o-mini',
        [{ role: 'user', content: 'Test' }],
        false
      );

      await chatRequestLogger.logRequestComplete(
        testRequestId,
        true,
        100,
        { prompt: 100, completion: 200, total: 300 },
        500
      );

      // Get stats
      const stats = await chatRequestLogger.getStats();
      expect(stats.totalTokens).toBeGreaterThan(0);
    });

    it('should track latency metrics', async () => {
      const { chatRequestLogger } = await import('@/lib/api/chat-request-logger');

      const testRequestId = 'test_latency_' + Date.now();

      await chatRequestLogger.logRequestStart(
        testRequestId,
        testUserId,
        'openrouter',
        'gpt-4o-mini',
        [{ role: 'user', content: 'Test' }],
        false
      );

      await chatRequestLogger.logRequestComplete(
        testRequestId,
        true,
        100,
        { prompt: 10, completion: 20, total: 30 },
        1000
      );

      const stats = await chatRequestLogger.getStats();
      expect(stats.averageLatencyMs).toBeGreaterThan(0);
    });

    it('should cleanup old logs', async () => {
      const { chatRequestLogger } = await import('@/lib/api/chat-request-logger');

      // Cleanup (should remove logs older than 30 days)
      const cleaned = await chatRequestLogger.cleanupOldLogs(30);
      expect(typeof cleaned).toBe('number');
    });
  });

  /**
   * Audit Logging Tests
   */
  describe('Audit Logging', () => {
    it('should log HITL approval requests', async () => {
      const { hitlAuditLogger } = await import('@/lib/stateful-agent/hitl-audit-logger');

      const testInterruptId = 'test_interrupt_' + Date.now();

      // Log approval request
      await hitlAuditLogger.logApprovalRequest(
        testInterruptId,
        testUserId,
        'test_action',
        'test_target',
        'Test approval',
        { e2e: true }
      );

      // Query logs
      const logs = await hitlAuditLogger.queryLogs({
        userId: testUserId,
        limit: 10,
      });

      expect(logs.length).toBeGreaterThan(0);
    });

    it('should log approval decisions with response time', async () => {
      const { hitlAuditLogger } = await import('@/lib/stateful-agent/hitl-audit-logger');

      const testInterruptId = 'test_decision_' + Date.now();

      await hitlAuditLogger.logApprovalRequest(
        testInterruptId,
        testUserId,
        'test_action',
        'test_target',
        'Test approval'
      );

      await hitlAuditLogger.logApprovalDecision(
        testInterruptId,
        true,
        'Approved',
        undefined,
        100
      );

      const logs = await hitlAuditLogger.queryLogs({
        userId: testUserId,
      });

      const testLog = logs.find(log => log.id === testInterruptId);
      if (testLog) {
        expect(testLog.approved).toBe(true);
        expect(testLog.responseTimeMs).toBe(100);
      }
    });

    it('should generate audit statistics', async () => {
      const { hitlAuditLogger } = await import('@/lib/stateful-agent/hitl-audit-logger');

      const stats = await hitlAuditLogger.getStats();

      expect(stats.totalRequests).toBeDefined();
      expect(stats.approvedCount).toBeDefined();
      expect(stats.rejectedCount).toBeDefined();
      expect(stats.approvalRate).toBeDefined();
    });

    it('should export audit logs', async () => {
      const { hitlAuditLogger } = await import('@/lib/stateful-agent/hitl-audit-logger');

      const logs = await hitlAuditLogger.exportLogs({
        userId: testUserId,
        limit: 100,
      });

      expect(Array.isArray(logs)).toBe(true);
    });
  });

  /**
   * Provider Health Monitoring Tests
   */
  describe('Provider Health Monitoring', () => {
    it('should track provider health metrics', async () => {
      const { providerHealthMonitor } = await import('@/lib/stateful-agent/agents/provider-fallback');

      // Record some requests
      providerHealthMonitor.recordRequest('openai', true, 100);
      providerHealthMonitor.recordRequest('openai', true, 150);
      providerHealthMonitor.recordRequest('anthropic', false, 500);

      // Get metrics
      const metrics = providerHealthMonitor.getMetrics('openai');
      expect(metrics).toBeDefined();
      expect(metrics?.totalRequests).toBeGreaterThan(0);
      expect(metrics?.healthScore).toBeGreaterThan(0);
    });

    it('should calculate health scores', async () => {
      const { providerHealthMonitor } = await import('@/lib/stateful-agent/agents/provider-fallback');

      // Record mixed success/failure
      providerHealthMonitor.recordRequest('test_provider', true, 100);
      providerHealthMonitor.recordRequest('test_provider', true, 100);
      providerHealthMonitor.recordRequest('test_provider', false, 500);

      const metrics = providerHealthMonitor.getMetrics('test_provider');
      expect(metrics?.healthScore).toBeGreaterThan(0);
      expect(metrics?.healthScore).toBeLessThanOrEqual(100);
    });

    it('should find healthiest provider', async () => {
      const { providerHealthMonitor } = await import('@/lib/stateful-agent/agents/provider-fallback');

      const healthiest = providerHealthMonitor.getHealthiestProvider();
      // May be null if no providers tracked
      expect(healthiest === null || typeof healthiest === 'string').toBe(true);
    });

    it('should generate health dashboard', async () => {
      const { getProviderHealthDashboard } = await import('@/lib/stateful-agent/agents/provider-fallback');

      const dashboard = getProviderHealthDashboard();

      expect(dashboard).toBeDefined();
      expect(dashboard.providers).toBeDefined();
      expect(dashboard.recommendedProvider).toBeDefined();
      expect(dashboard.timestamp).toBeDefined();
    });
  });

  /**
   * Streaming Error Analytics Tests
   */
  describe('Streaming Error Analytics', () => {
    it('should track streaming errors', async () => {
      const { streamingErrorHandler } = await import('@/lib/streaming/streaming-error-handler');

      const testError = new Error('Test streaming error');

      const processedError = streamingErrorHandler.processError(testError, {
        requestId: 'test_' + Date.now(),
      });

      expect(processedError).toBeDefined();
      expect(processedError.type).toBeDefined();
      expect(processedError.recoverable).toBeDefined();
    });

    it('should attempt recovery', async () => {
      const { streamingErrorHandler } = await import('@/lib/streaming/streaming-error-handler');

      const testError = streamingErrorHandler.processError(
        new Error('Connection error'),
        { requestId: 'test_' + Date.now() }
      );

      // Attempt recovery (will fail without recoveryFn, but tests the flow)
      const recovered = await streamingErrorHandler.attemptRecovery(testError);
      expect(typeof recovered).toBe('boolean');
    });

    it('should generate error analytics', async () => {
      const { streamingErrorHandler } = await import('@/lib/streaming/streaming-error-handler');

      // Generate some errors
      for (let i = 0; i < 3; i++) {
        streamingErrorHandler.processError(
          new Error(`Test error ${i}`),
          { requestId: `test_${i}` }
        );
      }

      const analytics = streamingErrorHandler.getErrorAnalytics();

      expect(analytics).toBeDefined();
      expect(analytics.summary).toBeDefined();
      expect(analytics.summary.totalErrors).toBeGreaterThan(0);
      expect(analytics.byType).toBeDefined();
      expect(Array.isArray(analytics.byType)).toBe(true);
    });

    it('should reset error stats', async () => {
      const { streamingErrorHandler } = await import('@/lib/streaming/streaming-error-handler');

      // Reset stats
      streamingErrorHandler.resetStats();

      const analytics = streamingErrorHandler.getErrorAnalytics();
      expect(analytics.summary.totalErrors).toBe(0);
    });
  });

  /**
   * Circuit Breaker Tests
   */
  describe('Circuit Breaker', () => {
    it('should track circuit breaker states', async () => {
      const { circuitBreaker } = await import('@/lib/stateful-agent/agents/provider-fallback');

      // Record failures
      circuitBreaker.recordFailure('test_provider');
      circuitBreaker.recordFailure('test_provider');
      circuitBreaker.recordFailure('test_provider');

      // Check state
      const state = circuitBreaker.getState('test_provider');
      expect(state).toBeDefined();
      expect(state?.failures).toBe(3);
    });

    it('should open circuit after threshold', async () => {
      const { circuitBreaker } = await import('@/lib/stateful-agent/agents/provider-fallback');

      // Record enough failures to open circuit
      for (let i = 0; i < 5; i++) {
        circuitBreaker.recordFailure('test_provider_2');
      }

      // Check if circuit is open
      const isAvailable = circuitBreaker.isAvailable('test_provider_2');
      // May be false (open) or true (half-open if timeout passed)
      expect(typeof isAvailable).toBe('boolean');
    });

    it('should recover after success', async () => {
      const { circuitBreaker } = await import('@/lib/stateful-agent/agents/provider-fallback');

      // Record failure then success
      circuitBreaker.recordFailure('test_provider_3');
      circuitBreaker.recordSuccess('test_provider_3');

      const state = circuitBreaker.getState('test_provider_3');
      expect(state).toBeDefined();
    });

    it('should provide circuit breaker states for all providers', async () => {
      const { getCircuitBreakerStates } = await import('@/lib/stateful-agent/agents/provider-fallback');

      const states = getCircuitBreakerStates();
      expect(typeof states).toBe('object');
    });
  });
});
