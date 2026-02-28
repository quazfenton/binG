/**
 * Unit Tests: Image Generation Provider Registry
 * 
 * Tests the image generation provider system
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImageProviderRegistry } from '@/lib/image-generation/provider-registry';
import { MistralImageProvider } from '@/lib/image-generation/providers/mistral-provider';
import { ReplicateImageProvider } from '@/lib/image-generation/providers/replicate-provider';

// Mock environment variables
vi.stubGlobal('process', {
  env: {
    MISTRAL_API_KEY: 'test-mistral-key',
    REPLICATE_API_TOKEN: 'test-replicate-token',
  },
});

describe('ImageProviderRegistry', () => {
  let registry: ImageProviderRegistry;

  beforeEach(() => {
    registry = new ImageProviderRegistry();
  });

  it('should register providers with priority', () => {
    const mockProvider = {
      id: 'test',
      name: 'Test Provider',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn(),
      getDefaultParams: vi.fn(),
    };

    registry.register(mockProvider as any, 1, true);
    
    expect(registry.getProvider('test')).toBeDefined();
  });

  it('should return providers sorted by priority', async () => {
    registry.register(
      { id: 'low', name: 'Low', isAvailable: vi.fn().mockResolvedValue(true), generate: vi.fn(), getDefaultParams: vi.fn() } as any,
      10
    );
    registry.register(
      { id: 'high', name: 'High', isAvailable: vi.fn().mockResolvedValue(true), generate: vi.fn(), getDefaultParams: vi.fn() } as any,
      1
    );

    const providers = await registry.getAvailableProviders();
    
    expect(providers[0].id).toBe('high');
    expect(providers[1].id).toBe('low');
  });

  it('should filter out unavailable providers', async () => {
    registry.register(
      { id: 'available', name: 'Available', isAvailable: vi.fn().mockResolvedValue(true), generate: vi.fn(), getDefaultParams: vi.fn() } as any,
      1
    );
    registry.register(
      { id: 'unavailable', name: 'Unavailable', isAvailable: vi.fn().mockResolvedValue(false), generate: vi.fn(), getDefaultParams: vi.fn() } as any,
      2
    );

    const providers = await registry.getAvailableProviders();
    
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('available');
  });

  it('should execute with fallback chain', async () => {
    const failingProvider = {
      id: 'fail',
      name: 'Failing',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockRejectedValue(new Error('Failed')),
      getDefaultParams: vi.fn(),
    };

    const successProvider = {
      id: 'success',
      name: 'Success',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockResolvedValue({ success: true, images: [] }),
      getDefaultParams: vi.fn(),
    };

    registry.register(failingProvider as any, 1);
    registry.register(successProvider as any, 2);

    const result = await registry.generateWithFallback(
      { prompt: 'test' },
      { providers: ['fail', 'success'] }
    );

    expect(result.success).toBe(true);
    expect(result.fallbackChain).toContain('fail');
    expect(result.fallbackChain).toContain('success');
  });

  it('should retry on retryable errors', async () => {
    let attempts = 0;
    const flakyProvider = {
      id: 'flaky',
      name: 'Flaky',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Rate limit exceeded');
        }
        return Promise.resolve({ success: true, images: [] });
      }),
      getDefaultParams: vi.fn(),
    };

    registry.register(flakyProvider as any, 1);

    const result = await registry.generateWithFallback(
      { prompt: 'test' },
      { maxRetries: 2 }
    );

    expect(result.success).toBe(true);
    expect(attempts).toBe(2);
  });

  it('should not retry on non-retryable errors', async () => {
    const failingProvider = {
      id: 'fail',
      name: 'Failing',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockRejectedValue(new Error('Invalid API key')),
      getDefaultParams: vi.fn(),
    };

    registry.register(failingProvider as any, 1);

    await expect(
      registry.generateWithFallback({ prompt: 'test' })
    ).rejects.toThrow();
  });

  it('should enable/disable providers', () => {
    const provider = {
      id: 'test',
      name: 'Test',
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn(),
      getDefaultParams: vi.fn(),
    };

    registry.register(provider as any, 1, true);
    registry.setProviderEnabled('test', false);

    expect(registry.getProvider('test')).toBeDefined();
    // Provider should be disabled
    const available = await registry.getAvailableProviders();
    expect(available.every(p => p.id !== 'test')).toBe(true);
  });
});

describe('MistralImageProvider', () => {
  let provider: MistralImageProvider;

  beforeEach(() => {
    provider = new MistralImageProvider();
  });

  it('should initialize with API key', () => {
    expect(provider.id).toBe('mistral');
    expect(provider.name).toBe('Mistral AI');
  });

  it('should have correct capabilities', () => {
    const capabilities = provider.capabilities;
    
    expect(capabilities.supportsNegativePrompt).toBe(false);
    expect(capabilities.supportsImg2Img).toBe(false);
    expect(capabilities.supportsSeed).toBe(false);
    expect(capabilities.supportsBatchGeneration).toBe(true);
    expect(capabilities.maxBatchSize).toBe(4);
  });

  it('should return default params', () => {
    const params = provider.getDefaultParams();
    
    expect(params.width).toBe(1024);
    expect(params.height).toBe(1024);
    expect(params.numImages).toBe(1);
  });

  it('should fail without API key', () => {
    vi.stubGlobal('process', { env: { MISTRAL_API_KEY: undefined } });
    
    expect(() => new MistralImageProvider()).toThrow();
  });
});

describe('ReplicateImageProvider', () => {
  let provider: ReplicateImageProvider;

  beforeEach(() => {
    provider = new ReplicateImageProvider();
  });

  it('should initialize with API token', () => {
    expect(provider.id).toBe('replicate');
    expect(provider.name).toBe('Replicate');
  });

  it('should have correct capabilities', () => {
    const capabilities = provider.capabilities;
    
    expect(capabilities.supportsNegativePrompt).toBe(true);
    expect(capabilities.supportsImg2Img).toBe(true);
    expect(capabilities.supportsSeed).toBe(true);
    expect(capabilities.supportsBatchGeneration).toBe(true);
  });

  it('should support multiple models', () => {
    expect(provider.models).toContain('stability-ai/stable-diffusion-xl-base-1.0');
    expect(provider.models).toContain('black-forest-labs/flux-schnell');
  });
});

describe('Image Generation Types', () => {
  it('should have correct aspect ratio dimensions', async () => {
    const { ASPECT_RATIO_DIMENSIONS } = await import('@/lib/image-generation/types');
    
    expect(ASPECT_RATIO_DIMENSIONS['1:1']).toEqual({ width: 1024, height: 1024 });
    expect(ASPECT_RATIO_DIMENSIONS['16:9']).toEqual({ width: 1280, height: 720 });
    expect(ASPECT_RATIO_DIMENSIONS['9:16']).toEqual({ width: 720, height: 1280 });
  });

  it('should have correct quality presets', async () => {
    const { QUALITY_PRESETS } = await import('@/lib/image-generation/types');
    
    expect(QUALITY_PRESETS.low).toEqual({ steps: 20, guidance: 5 });
    expect(QUALITY_PRESETS.high).toEqual({ steps: 40, guidance: 6 });
    expect(QUALITY_PRESETS.ultra).toEqual({ steps: 60, guidance: 7 });
  });

  it('should have correct style presets', async () => {
    const { STYLE_PRESETS } = await import('@/lib/image-generation/types');
    
    expect(STYLE_PRESETS).toContain('Photorealistic');
    expect(STYLE_PRESETS).toContain('Anime');
    expect(STYLE_PRESETS).toContain('Digital Art');
  });
});
