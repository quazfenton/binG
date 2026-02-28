/**
 * Tests for Tambo React Hooks
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Mock fetch globally
global.fetch = vi.fn();

describe('Tambo React Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useTambo', () => {
    it('should be importable', () => {
      const { useTambo } = require('../react-hooks');
      expect(useTambo).toBeDefined();
      expect(typeof useTambo).toBe('function');
    });

    it('should initialize with empty messages', () => {
      const { useTambo } = require('../react-hooks');
      
      const { result } = renderHook(() =>
        useTambo({ apiKey: 'test_key' })
      );

      expect(result.current.messages).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('should have sendMessage function', () => {
      const { useTambo } = require('../react-hooks');
      
      const { result } = renderHook(() =>
        useTambo({ apiKey: 'test_key' })
      );

      expect(typeof result.current.sendMessage).toBe('function');
    });

    it('should have clearHistory function', () => {
      const { useTambo } = require('../react-hooks');
      
      const { result } = renderHook(() =>
        useTambo({ apiKey: 'test_key' })
      );

      expect(typeof result.current.clearHistory).toBe('function');
    });
  });

  describe('useTamboThreadInput', () => {
    it('should be importable', () => {
      const { useTamboThreadInput } = require('../react-hooks');
      expect(useTamboThreadInput).toBeDefined();
      expect(typeof useTamboThreadInput).toBe('function');
    });

    it('should initialize with empty value', () => {
      const { useTamboThreadInput } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboThreadInput());

      expect(result.current.value).toBe('');
      expect(result.current.isPending).toBe(false);
    });

    it('should have setValue function', () => {
      const { useTamboThreadInput } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboThreadInput());

      expect(typeof result.current.setValue).toBe('function');
    });

    it('should have submit function', () => {
      const { useTamboThreadInput } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboThreadInput());

      expect(typeof result.current.submit).toBe('function');
    });
  });

  describe('useTamboComponentState', () => {
    it('should be importable', () => {
      const { useTamboComponentState } = require('../react-hooks');
      expect(useTamboComponentState).toBeDefined();
      expect(typeof useTamboComponentState).toBe('function');
    });

    it('should initialize with provided state', () => {
      const { useTamboComponentState } = require('../react-hooks');
      
      const initialState = { data: [1, 2, 3] };
      const { result } = renderHook(() =>
        useTamboComponentState('test', initialState)
      );

      expect(result.current.state).toEqual(initialState);
    });

    it('should have setState function', () => {
      const { useTamboComponentState } = require('../react-hooks');
      
      const { result } = renderHook(() =>
        useTamboComponentState('test')
      );

      expect(typeof result.current.setState).toBe('function');
    });
  });

  describe('useTamboStreamStatus', () => {
    it('should be importable', () => {
      const { useTamboStreamStatus } = require('../react-hooks');
      expect(useTamboStreamStatus).toBeDefined();
      expect(typeof useTamboStreamStatus).toBe('function');
    });

    it('should initialize with idle status', () => {
      const { useTamboStreamStatus } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboStreamStatus());

      expect(result.current.status).toBe('idle');
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.isComplete).toBe(false);
    });

    it('should start streaming when componentId provided', async () => {
      const { useTamboStreamStatus } = require('../react-hooks');
      
      const { result, rerender } = renderHook(
        ({ componentId }) => useTamboStreamStatus(componentId),
        { initialProps: { componentId: undefined } }
      );

      // Initially idle
      expect(result.current.status).toBe('idle');

      // Provide componentId to start streaming
      rerender({ componentId: 'test-component' });

      // Should be streaming after effect runs
      await waitFor(() => {
        expect(result.current.isStreaming).toBe(true);
      });
    });
  });

  describe('useTamboComponents', () => {
    it('should be importable', () => {
      const { useTamboComponents } = require('../react-hooks');
      expect(useTamboComponents).toBeDefined();
      expect(typeof useTamboComponents).toBe('function');
    });

    it('should initialize with empty components', () => {
      const { useTamboComponents } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboComponents());

      expect(result.current.components).toEqual([]);
    });

    it('should have registerComponent function', () => {
      const { useTamboComponents } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboComponents());

      expect(typeof result.current.registerComponent).toBe('function');
    });

    it('should register component', () => {
      const { useTamboComponents } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboComponents());

      act(() => {
        result.current.registerComponent({
          name: 'TestComponent',
          description: 'Test',
          propsSchema: {} as any,
          component: {} as any,
        });
      });

      expect(result.current.components).toHaveLength(1);
      expect(result.current.components[0].name).toBe('TestComponent');
    });

    it('should register multiple components', () => {
      const { useTamboComponents } = require('../react-hooks');
      
      const { result } = renderHook(() => useTamboComponents());

      act(() => {
        result.current.registerComponents([
          {
            name: 'Component1',
            description: 'Test 1',
            propsSchema: {} as any,
            component: {} as any,
          },
          {
            name: 'Component2',
            description: 'Test 2',
            propsSchema: {} as any,
            component: {} as any,
          },
        ]);
      });

      expect(result.current.components).toHaveLength(2);
    });
  });

  describe('TamboProvider', () => {
    it('should be importable', () => {
      const { TamboProvider } = require('../react-hooks');
      expect(TamboProvider).toBeDefined();
      expect(typeof TamboProvider).toBe('function');
    });
  });

  describe('useTamboContext', () => {
    it('should be importable', () => {
      const { useTamboContext } = require('../react-hooks');
      expect(useTamboContext).toBeDefined();
      expect(typeof useTamboContext).toBe('function');
    });

    it('should throw error when used outside provider', () => {
      const { useTamboContext } = require('../react-hooks');
      
      expect(() => {
        renderHook(() => useTamboContext());
      }).toThrow('useTamboContext must be used within TamboProvider');
    });
  });
});

describe('TamboClient', () => {
  it('should create thread', async () => {
    const mockResponse = { id: 'thread_123' };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { TamboClient } = require('../react-hooks');
    const client = new TamboClient('test_key');

    const result = await client.createThread('user_123');

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.tambo.ai/v1/threads',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test_key',
        }),
      })
    );
  });

  it('should send message', async () => {
    const mockResponse = {
      message: { content: 'Hello', role: 'assistant' },
      renderedComponent: { name: 'Chart', props: { data: [] } },
    };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { TamboClient } = require('../react-hooks');
    const client = new TamboClient('test_key');

    const result = await client.sendMessage('thread_123', 'Hello');

    expect(result).toEqual(mockResponse);
  });

  it('should get thread', async () => {
    const mockResponse = { messages: [] };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { TamboClient } = require('../react-hooks');
    const client = new TamboClient('test_key');

    const result = await client.getThread('thread_123');

    expect(result).toEqual(mockResponse);
  });

  it('should handle API errors', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: 'Unauthorized',
    });

    const { TamboClient } = require('../react-hooks');
    const client = new TamboClient('invalid_key');

    await expect(client.createThread('user_123'))
      .rejects
      .toThrow('Failed to create thread: Unauthorized');
  });
});
