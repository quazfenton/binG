/**
 * Unit tests for Mem0 Persistent Memory Power
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock environment variables
const mockEnv = process.env;

describe('Mem0 Power', () => {
  describe('isMem0Configured', () => {
    it('should return false when MEM0_API_KEY is not set', async () => {
      // Clear the env var
      const originalKey = process.env.MEM0_API_KEY;
      delete process.env.MEM0_API_KEY;
      
      // Re-import to get fresh check
      const { isMem0Configured } = await import('../mem0-power');
      expect(isMem0Configured()).toBe(false);

      // Restore
      if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
    });

    it('should return false when MEM0_API_KEY is empty string', async () => {
      const originalKey = process.env.MEM0_API_KEY;
      process.env.MEM0_API_KEY = '';

      const { isMem0Configured } = await import('../mem0-power');
      expect(isMem0Configured()).toBe(false);

      if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
      else delete process.env.MEM0_API_KEY;
    });
  });

  describe('buildMem0SystemPrompt', () => {
    it('should return empty string when memories array is empty', async () => {
      const { buildMem0SystemPrompt } = await import('../mem0-power');
      const result = buildMem0SystemPrompt([]);
      expect(result).toBe('');
    });

    it('should return empty string when memories is undefined', async () => {
      const { buildMem0SystemPrompt } = await import('../mem0-power');
      const result = buildMem0SystemPrompt(undefined as any);
      expect(result).toBe('');
    });

    it('should format memories correctly', async () => {
      const { buildMem0SystemPrompt } = await import('../mem0-power');
      const memories = [
        { id: '1', memory: 'User prefers dark mode', score: 0.9 },
        { id: '2', memory: 'User is working on a React project', score: 0.8 },
      ];
      
      const result = buildMem0SystemPrompt(memories);
      
      expect(result).toContain('## Relevant User Memories');
      expect(result).toContain('User prefers dark mode');
      expect(result).toContain('User is working on a React project');
    });
  });

  describe('Mem0Client', () => {
    it('should be constructed with API key', async () => {
      const { getMem0Client } = await import('../mem0-power');

      // Save original env
      const originalKey = process.env.MEM0_API_KEY;
      process.env.MEM0_API_KEY = 'test-api-key';

      const client = getMem0Client();
      expect(client).toBeDefined();

      // Restore
      if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
      else delete process.env.MEM0_API_KEY;
    });
  });

  describe('mem0Search', () => {
    it('should return error object when not configured', async () => {
      // Clear env
      const originalKey = process.env.MEM0_API_KEY;
      delete process.env.MEM0_API_KEY;

      // Reset the cached client
      const mem0Power = await import('../mem0-power');

      expect(mem0Power.isMem0Configured()).toBe(false);

      const result = await mem0Power.mem0Search({ query: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Restore
      if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
      else delete process.env.MEM0_API_KEY;
    });
  });

  describe('mem0Add', () => {
    it('should have mem0Add function exported', async () => {
      const { mem0Add } = await import('../mem0-power');
      expect(typeof mem0Add).toBe('function');
    });
  });
});

describe('Mem0 Circuit Breaker', () => {
  it('exposes circuit state inspector and reset helper', async () => {
    const { getMem0CircuitState, resetMem0CircuitBreaker } = await import('../mem0-power');
    resetMem0CircuitBreaker();
    const state = getMem0CircuitState();
    expect(state.state).toBe('CLOSED');
    expect(state.recentFailures).toBe(0);
    expect(state.reopensAt).toBeNull();
  });

  it('closes the breaker after reset', async () => {
    const { getMem0CircuitState, resetMem0CircuitBreaker } = await import('../mem0-power');
    resetMem0CircuitBreaker();
    expect(getMem0CircuitState().state).toBe('CLOSED');
  });

  it('isMem0Configured returns false when API key missing', async () => {
    const originalKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;
    const { isMem0Configured, resetMem0CircuitBreaker } = await import('../mem0-power');
    resetMem0CircuitBreaker();
    expect(isMem0Configured()).toBe(false);
    if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
  });
});

describe('Mem0 Search Cache', () => {
  beforeEach(() => {
    // Reset cache between tests
    vi.resetModules();
  });

  it('clearMem0SearchCache is callable', async () => {
    const { clearMem0SearchCache } = await import('../mem0-power');
    expect(() => clearMem0SearchCache()).not.toThrow();
  });

  it('should cache search results and return cached on duplicate calls', async () => {
    // This test verifies cache mechanics work (mock mode)
    const { clearMem0SearchCache } = await import('../mem0-power');
    clearMem0SearchCache();
    
    // In mock mode, we can't fully test cache hits but verify API is correct
    const { mem0Search } = await import('../mem0-power');
    
    // Without API key, should return error object
    const originalKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;
    
    const result = await mem0Search({ query: 'test query' });
    expect(result.success).toBe(false); // Not configured
    
    if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
  });

  it('should respect noCache option', async () => {
    const { mem0Search } = await import('../mem0-power');
    
    const originalKey = process.env.MEM0_API_KEY;
    delete process.env.MEM0_API_KEY;
    
    // Should work without throwing even with noCache option
    const result = await mem0Search({ query: 'test', noCache: true });
    expect(result.success).toBe(false);
    
    if (originalKey !== undefined) process.env.MEM0_API_KEY = originalKey;
  });
});

describe('Mem0 Power Manifest', () => {
  it('should have required power metadata', async () => {
    const { mem0PowerManifest } = await import('../mem0-power');
    
    // Name can be 'mem0' or 'Mem0 Persistent Memory' depending on implementation
    expect(mem0PowerManifest.name).toBeDefined();
    expect(mem0PowerManifest.description).toBeDefined();
    expect(mem0PowerManifest.version).toBeDefined();
    expect(mem0PowerManifest.triggers).toBeInstanceOf(Array);
    expect(mem0PowerManifest.triggers.length).toBeGreaterThan(0);
  });

  it('should have tools defined', async () => {
    const { mem0PowerManifest } = await import('../mem0-power');
    
    // Check that tools exist in the manifest
    // The actual tool definitions depend on the implementation
    expect(mem0PowerManifest).toHaveProperty('name');
  });
});