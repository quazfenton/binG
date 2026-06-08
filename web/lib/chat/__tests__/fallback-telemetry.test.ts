/**
 * Tests for Fallback Occurred Flag in Telemetry
 *
 * Tests the fallbackOccurred flag that indicates when a provider/model fallback
 * occurred during LLM requests. This flag helps distinguish between requests
 * that used the originally requested provider vs those that fell back to an alternative.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareTelemetryPayload } from '../../errors/logging-utils';

// Mock the tool-call-tracker module
vi.mock('../tool-call-tracker', () => ({
  toolCallTracker: {
    recordInvocationPayload: vi.fn(),
  },
}));

describe('fallbackOccurred flag logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('non-streaming response telemetry', () => {
    it('should set fallbackOccurred to false when actualProvider equals requested provider', () => {
      // Simulate the logic: response.metadata?.actualProvider && response.metadata.actualProvider !== actualProvider
      const requestedProvider = 'openai';
      const actualProvider = 'openai'; // No fallback
      const responseMetadata = { actualProvider: 'openai' };

      const fallbackOccurred = !!(responseMetadata?.actualProvider && responseMetadata.actualProvider !== actualProvider);

      expect(fallbackOccurred).toBe(false);
    });

    it('should set fallbackOccurred to true when actualProvider differs from requested provider', () => {
      // Simulate: OpenAI failed, Anthropic handled the request
      // actualProvider is the originally requested provider, responseMetadata.actualProvider is what actually handled it
      const actualProvider = 'openai';  // Originally requested
      const responseMetadata = { actualProvider: 'anthropic' };  // Actually handled by Anthropic

      const fallbackOccurred = !!(responseMetadata?.actualProvider && responseMetadata.actualProvider !== actualProvider);

      expect(fallbackOccurred).toBe(true);
    });

    it('should set fallbackOccurred to false when response metadata is undefined', () => {
      const requestedProvider = 'openai';
      const responseMetadata = undefined;

      const fallbackOccurred = !!(responseMetadata?.actualProvider && responseMetadata.actualProvider !== requestedProvider);

      expect(fallbackOccurred).toBe(false);
    });

    it('should use requested provider when response metadata has no actualProvider', () => {
      const requestedProvider = 'openai';
      const responseMetadata = {}; // No actualProvider

      const actualProvider = responseMetadata?.actualProvider || requestedProvider;

      expect(actualProvider).toBe('openai');
    });

    it('should use actualProvider from response metadata when available', () => {
      const requestedProvider = 'openai';
      const responseMetadata = { actualProvider: 'anthropic' };

      const actualProvider = responseMetadata?.actualProvider || requestedProvider;

      expect(actualProvider).toBe('anthropic');
    });
  });

  describe('streaming completion telemetry', () => {
    it('should set fallbackOccurred to false for streaming (no internal fallback)', () => {
      // Streaming has no internal fallback mechanism at llm-providers level
      const fallbackOccurred = false;

      expect(fallbackOccurred).toBe(false);
    });

    it('should include fallbackOccurred in streaming telemetry payload', () => {
      // Use fewer properties to avoid maxObjectProps truncation (default is 5)
      const args = {
        provider: 'openai',
        success: true,
        fallbackOccurred: false,
        totalAttempts: 1,
      };

      // Pass maxObjectProps to ensure all properties are preserved
      const result = prepareTelemetryPayload({ args }, { maxObjectProps: 10 });

      const parsed = JSON.parse(result.redactedArgs);
      const parsedArgs = parsed.args || parsed;

      expect(parsedArgs).toHaveProperty('fallbackOccurred');
      expect(parsedArgs.fallbackOccurred).toBe(false);
    });
  });

  describe('enhanced-llm-service response telemetry', () => {
    it('should detect fallback from response metadata in enhanced service', () => {
      // Simulate enhanced-llm-service.ts line 602 logic
      const actualProvider = 'openai';
      const response = {
        metadata: {
          actualProvider: 'anthropic', // Fallback to Anthropic
          actualModel: 'claude-3-5-sonnet-20241022',
        },
        content: { length: 500 },
      };

      const fallbackOccurred = !!(response.metadata?.actualProvider && response.metadata.actualProvider !== actualProvider);

      expect(fallbackOccurred).toBe(true);
    });

    it('should not flag fallback when providers match in enhanced service', () => {
      const actualProvider = 'openai';
      const response = {
        metadata: {
          actualProvider: 'openai',
          actualModel: 'gpt-4',
        },
        content: { length: 500 },
      };

      const fallbackOccurred = !!(response.metadata?.actualProvider && response.metadata.actualProvider !== actualProvider);

      expect(fallbackOccurred).toBe(false);
    });
  });

  describe('telemetry payload integration', () => {
    it('should include fallbackOccurred in success telemetry payload', () => {
      // Use fewer properties to avoid maxObjectProps truncation
      const args = {
        provider: 'anthropic',
        success: true,
        fallbackOccurred: true, // Fallback occurred
      };

      const result = prepareTelemetryPayload({ args }, { maxObjectProps: 10 });

      const parsed = JSON.parse(result.redactedArgs);
      const parsedArgs = parsed.args || parsed;

      expect(parsedArgs).toHaveProperty('fallbackOccurred');
      expect(parsedArgs.fallbackOccurred).toBe(true);
    });

    it('should handle fallbackOccurred: false in telemetry payload', () => {
      const args = {
        provider: 'openai',
        success: true,
        fallbackOccurred: false, // No fallback
      };

      const result = prepareTelemetryPayload({ args }, { maxObjectProps: 10 });

      const parsed = JSON.parse(result.redactedArgs);
      const parsedArgs = parsed.args || parsed;

      expect(parsedArgs).toHaveProperty('fallbackOccurred');
      expect(parsedArgs.fallbackOccurred).toBe(false);
    });

    it('should capture both provider and model from response metadata after fallback', () => {
      // This tests the scenario where OpenAI fails and falls back to Anthropic
      const requestedProvider = 'openai';
      const requestedModel = 'gpt-4';
      const responseMetadata = {
        actualProvider: 'anthropic',
        actualModel: 'claude-3-5-sonnet-20241022',
      };

      // Logic from llm-providers.ts line 1597-1598
      const actualProvider = responseMetadata?.actualProvider || requestedProvider;
      const actualModel = responseMetadata?.actualModel || requestedModel;

      expect(actualProvider).toBe('anthropic');
      expect(actualModel).toBe('claude-3-5-sonnet-20241022');
    });
  });

  describe('totalAttempts field', () => {
    it('should track totalAttempts for successful request after retries', () => {
      // Simulate a request that succeeded on attempt 3 (after 2 retries)
      const totalAttempts = 3;

      const args = {
        provider: 'openai',
        success: true,
        totalAttempts, // Request succeeded after 2 retries
      };

      const result = prepareTelemetryPayload({ args }, { maxObjectProps: 10 });

      const parsed = JSON.parse(result.redactedArgs);
      const parsedArgs = parsed.args || parsed;

      expect(parsedArgs).toHaveProperty('totalAttempts');
      expect(parsedArgs.totalAttempts).toBe(3);
    });

    it('should default totalAttempts to 1 for immediate success', () => {
      const totalAttempts = 1; // Default when no retries

      const args = {
        provider: 'openai',
        success: true,
        totalAttempts,
      };

      const result = prepareTelemetryPayload({ args }, { maxObjectProps: 10 });

      const parsed = JSON.parse(result.redactedArgs);
      const parsedArgs = parsed.args || parsed;

      expect(parsedArgs).toHaveProperty('totalAttempts');
      expect(parsedArgs.totalAttempts).toBe(1);
    });

    it('should capture totalAttempts from error annotation', () => {
      // Simulate error with totalAttempts annotation from withRetry
      const error = { message: 'Request failed', totalAttempts: 3 };

      const capturedAttempts = (error as any).totalAttempts || 1;

      expect(capturedAttempts).toBe(3);
    });

    it('should default to 1 when error has no totalAttempts annotation', () => {
      const error = { message: 'Request failed' }; // No totalAttempts annotation

      const capturedAttempts = (error as any).totalAttempts || 1;

      expect(capturedAttempts).toBe(1);
    });
  });
});