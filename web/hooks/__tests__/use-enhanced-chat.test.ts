import { describe, expect, it, vi, beforeEach } from 'vitest';
import { rotateProviderModel } from '../use-enhanced-chat';

// Mock the dynamic import of provider-fallback-chains
vi.mock('@/lib/providers/provider-fallback-chains', () => ({
  getConfiguredFallbackChain: vi.fn(),
}));

const { getConfiguredFallbackChain } = await import('@/lib/providers/provider-fallback-chains');

describe('rotateProviderModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('same-provider model rotation (retryCount=0)', () => {
    it('rotates to next model in the same provider', async () => {
      const result = await rotateProviderModel('google', 'gemini-2.5-flash', 0);

      expect(result.selectedProvider).toBe('google');
      // google has: gemini-2.5-flash, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash, gemini-2.5-pro
      expect(result.selectedModel).toBe('gemini-2.0-flash');
    });

    it('wraps around to first model when on last model', async () => {
      const result = await rotateProviderModel('google', 'gemini-2.5-pro', 0);

      expect(result.selectedProvider).toBe('google');
      expect(result.selectedModel).toBe('gemini-2.5-flash');
    });

    it('rotates to first model when requested model is not in provider list', async () => {
      // When model is not in the provider list, indexOf returns -1,
      // nextIdx defaults to 0, selecting the provider's first model.
      // This is intentional — same-provider fallback is preferred over
      // crossing to another provider on the first retry.
      const result = await rotateProviderModel('google', 'nonexistent-model', 0);

      expect(result.selectedProvider).toBe('google');
      expect(result.selectedModel).toBe('gemini-2.5-flash');
    });
  });

  describe('fallback chain (retryCount=0, single-model providers)', () => {
    it('falls back to first provider in fallback chain for single-model provider', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue(['google', 'mistral']);

      // 'zen' has only one model, so rotation can't happen within the provider
      const result = await rotateProviderModel('zen', 'zen', 0);

      expect(result.selectedProvider).toBe('google');
      expect(result.selectedModel).toBe('gemini-2.5-flash');
    });

    it('falls back to first provider in chain when rotation does not change model', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue(['mistral']);

      // 'fireworks' has only one model, so rotation stays same
      const result = await rotateProviderModel('fireworks', 'accounts/fireworks/models/llama-v3p1-70b-instruct', 0);

      expect(result.selectedProvider).toBe('mistral');
      expect(result.selectedModel).toBe('mistral-small-latest');
    });
  });

  describe('fallback chain cycling (retryCount>=1)', () => {
    it('cycles to provider at retryCount index in fallback chain', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue(['google', 'anthropic', 'mistral']);

      const result = await rotateProviderModel('nvidia', 'moonshotai/kimi-k2.5', 2);

      // retryCount=2 → (2-1) % 3 = 1 → 'anthropic'
      expect(result.selectedProvider).toBe('anthropic');
      expect(result.selectedModel).toBe('claude-sonnet-4-20250514');
    });

    it('wraps around fallback chain correctly', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue(['google', 'mistral']);

      const result = await rotateProviderModel('nvidia', 'moonshotai/kimi-k2.5', 5);

      // retryCount=5 → (5-1) % 2 = 0 → 'google'
      expect(result.selectedProvider).toBe('google');
      expect(result.selectedModel).toBe('gemini-2.5-flash');
    });

    it('returns original provider/model when fallback chain is empty', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue([]);

      const result = await rotateProviderModel('nvidia', 'some-model', 3);

      // Empty chain, no rotation possible
      expect(result.selectedProvider).toBe('nvidia');
      expect(result.selectedModel).toBe('some-model');
    });
  });

  describe('empty/unknown provider handling', () => {
    it('returns empty defaults when origProvider is empty string', async () => {
      const result = await rotateProviderModel('', '', 0);

      expect(result.selectedProvider).toBe('');
      expect(result.selectedModel).toBe('');
    });

    it('handles unknown provider gracefully by trying fallback chain', async () => {
      vi.mocked(getConfiguredFallbackChain).mockReturnValue(['google']);

      const result = await rotateProviderModel('unknown-provider', 'some-model', 0);

      // retryCount=0, but 'unknown-provider' is falsy for the same-provider rotation branch
      // It falls to the else branch and rotates through fallback chain
      // Wait - retryCount=0 would go to the first branch, but origProvider is truthy ('unknown-provider')
      // So it tries PROVIDER_MODELS['unknown-provider'] which is undefined
      // Then falls through to getConfiguredFallbackChain('unknown-provider')
      expect(result.selectedProvider).toBe('google');
      expect(result.selectedModel).toBe('gemini-2.5-flash');
    });
  });

  describe('error handling in fallback chain imports', () => {
    it('returns original provider/model when dynamic import fails', async () => {
      vi.mocked(getConfiguredFallbackChain).mockImplementation(() => {
        throw new Error('Import failed');
      });

      const result = await rotateProviderModel('nvidia', 'moonshotai/kimi-k2.5', 2);

      // Error caught, returns original values
      expect(result.selectedProvider).toBe('nvidia');
      expect(result.selectedModel).toBe('moonshotai/kimi-k2.5');
    });
  });

  describe('context parameter', () => {
    it('passes context through to log messages (default is "retry")', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await rotateProviderModel('google', 'gemini-2.5-flash', 0);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Chat] Rotating to next model [retry]: google/gemini-2.0-flash')
      );

      warnSpy.mockRestore();
    });

    it('includes custom context in log messages when provided', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await rotateProviderModel('google', 'gemini-2.5-flash', 0, 'pre-stream');

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Chat] Rotating to next model [pre-stream]: google/gemini-2.0-flash')
      );

      warnSpy.mockRestore();
    });
  });
});
