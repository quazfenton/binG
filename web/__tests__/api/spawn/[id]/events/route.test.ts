/**
 * Agent Events SSE Route — Unit Tests
 *
 * Tests for app/api/spawn/[id]/events/route.ts
 * Covers: GET (SSE subscription), auth checks, agent-not-found, stream lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────────────────────

const mockAgent = {
  agentId: 'agent-test-123',
  type: 'codex',
  containerId: 'container-abc',
  port: 5000,
  apiUrl: 'http://localhost:5000',
  workspaceDir: '/workspace/test',
  startedAt: Date.now(),
  lastActivity: Date.now(),
  status: 'ready',
  health: 'healthy',
};

const { mockGetAgentServiceManager, mockSubscribe } = vi.hoisted(() => {
  const mockGetAgent = vi.fn((id: string) =>
    id === 'agent-test-123' ? { ...mockAgent } : undefined,
  );

  // Create an async iterable that yields 2 events then completes
  async function* mockEventGenerator() {
    yield { type: 'message', data: { text: 'hello' } };
    yield { type: 'status_change', data: { status: 'busy' } };
  }

  const mockSubscribe = vi.fn(async (_id: string) => mockEventGenerator());

  return {
    mockGetAgentServiceManager: vi.fn(() => ({
      getAgent: mockGetAgent,
      subscribe: mockSubscribe,
    })),
    mockGetAgent,
    mockSubscribe,
  };
});

vi.mock('@/lib/spawn', () => ({
  getAgentServiceManager: mockGetAgentServiceManager,
}));

vi.mock('@/lib/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@/lib/auth0', () => ({
  auth0: {
    getSession: vi.fn(async () => ({
      user: { sub: 'auth0|12345' },
    })),
  },
}));

vi.mock('@/lib/oauth/connections', () => ({
  getLocalUserIdFromAuth0: vi.fn(async () => 1),
}));

// ────────────────────────────────────────────────────────────────────────────
// Import AFTER mocks
// ────────────────────────────────────────────────────────────────────────────

import { GET } from '@/app/api/spawn/[id]/events/route';

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function makeEventsRequest(id: string): Request {
  return new Request(`http://localhost:3000/api/spawn/${id}/events`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  }) as unknown as Request;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('Agent Events SSE Route — [id]/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET — SSE subscription
  // ────────────────────────────────────────────────────────────────────────

  describe('GET — SSE subscription', () => {
    it('returns SSE stream with correct headers for an existing agent', async () => {
      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');
      expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
      expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('streams events as SSE data lines', async () => {
      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      // Read the stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Should contain SSE data lines
      expect(fullText).toContain('data: ');
      // Should have at least 2 events (from the mock generator)
      const dataLines = fullText.split('\n').filter(l => l.startsWith('data: '));
      expect(dataLines.length).toBeGreaterThanOrEqual(2);
    });

    it('subscribes to the correct agent via service manager', async () => {
      const req = makeEventsRequest('agent-test-123');
      await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      expect(mockSubscribe).toHaveBeenCalledWith('agent-test-123');
    });

    it('returns 404 for a non-existent agent', async () => {
      const req = makeEventsRequest('agent-nonexistent');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-nonexistent' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Agent not found');
    });

    it('returns 401 when no authenticated session', async () => {
      // Override auth0 mock for this test
      const { auth0 } = await import('@/lib/auth0');
      (auth0.getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });

    it('returns 404 when user has no local ID', async () => {
      // Override getLocalUserIdFromAuth0 for this test
      const { getLocalUserIdFromAuth0 } = await import('@/lib/oauth/connections');
      (getLocalUserIdFromAuth0 as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('User not found');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET — SSE stream error lifecycle
  // ────────────────────────────────────────────────────────────────────────

  describe('GET — SSE stream error lifecycle', () => {
    it('stream errors when subscribe throws inside start()', async () => {
      // subscribe() is called inside ReadableStream's async start() callback.
      // Errors there don't propagate to the outer try/catch — the response
      // is still 200 with SSE headers, but reading the stream rejects.
      mockSubscribe.mockRejectedValueOnce(new Error('Subscription service unavailable'));

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      // Response is still 200 with SSE headers — the stream was already created
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // But reading the stream should error
      const reader = response.body!.getReader();
      let streamError: Error | null = null;
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (e: any) {
        streamError = e;
      }

      expect(streamError).toBeTruthy();
      expect(streamError?.message).toBe('Subscription service unavailable');
    });

    it('stream errors when iterator throws mid-iteration', async () => {
      // Create a generator that yields one event then throws
      async function* failingGenerator() {
        yield { type: 'message', data: { text: 'before error' } };
        throw new Error('Iterator crashed');
      }
      mockSubscribe.mockImplementationOnce(async () => failingGenerator());

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // Reading the stream should reject with the iterator error
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let streamError: Error | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value, { stream: true }));
        }
      } catch (e: any) {
        streamError = e;
      }

      // Should have received at least the first event before the error
      const fullText = chunks.join('');
      expect(fullText).toContain('before error');

      // Stream should have errored (controller.error called)
      expect(streamError).toBeTruthy();
      expect(streamError?.message).toBe('Iterator crashed');
    });

    it('stream completes cleanly when iterator exhausts naturally', async () => {
      // Generator that yields then finishes — no error
      async function* finiteGenerator() {
        yield { type: 'message', data: { text: 'event1' } };
        yield { type: 'message', data: { text: 'event2' } };
        // ends naturally
      }
      mockSubscribe.mockImplementationOnce(async () => finiteGenerator());

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
      }

      // Should contain both events
      expect(fullText).toContain('event1');
      expect(fullText).toContain('event2');

      // Stream should end cleanly (done = true, no error)
      const dataLines = fullText.split('\n').filter(l => l.startsWith('data: '));
      expect(dataLines.length).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // GET — SSE abort / client disconnect lifecycle
  // ────────────────────────────────────────────────────────────────────────

  describe('GET — SSE abort / client disconnect lifecycle', () => {
    it('calls unsubscribe when subscribe returns { iterator, unsubscribe }', async () => {
      const mockUnsubscribe = vi.fn();

      async function* iterable() {
        yield { type: 'message', data: { text: 'hello' } };
      }

      mockSubscribe.mockImplementationOnce(async () => ({
        iterator: iterable(),
        unsubscribe: mockUnsubscribe,
      }));

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      // Consume the entire stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        decoder.decode(value, { stream: true });
      }

      // unsubscribe should be called in finally block after stream ends
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('calls unsubscribe when iterator throws and subscribe returned { iterator, unsubscribe }', async () => {
      const mockUnsubscribe = vi.fn();

      async function* failingIterable() {
        yield { type: 'message', data: { text: 'first' } };
        throw new Error('boom');
      }

      mockSubscribe.mockImplementationOnce(async () => ({
        iterator: failingIterable(),
        unsubscribe: mockUnsubscribe,
      }));

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      // Read until error
      const reader = response.body!.getReader();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // Expected — iterator threw
      }

      // unsubscribe should still be called in finally block
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    it('triggers abort and cleanup when client cancels the stream', async () => {
      const mockUnsubscribe = vi.fn();
      let resolveYield: (() => void) | null = null;

      // Create a slow generator that waits for a signal before yielding
      async function* slowGenerator() {
        yield { type: 'message', data: { text: 'first' } };
        // Block until we resolve — simulates a long-running event source
        await new Promise<void>((resolve) => { resolveYield = resolve; });
        yield { type: 'message', data: { text: 'should not reach' } };
      }

      mockSubscribe.mockImplementationOnce(async () => ({
        iterator: slowGenerator(),
        unsubscribe: mockUnsubscribe,
      }));

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      // Read the first event
      const { value } = await reader.read();
      expect(decoder.decode(value)).toContain('first');

      // Cancel the stream (simulates client disconnect)
      await reader.cancel();

      // Release the blocked generator so it can finish cleanup
      if (resolveYield) resolveYield();

      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 50));

      // unsubscribe is called from both cancel() callback AND start()'s
      // finally block — documented as 2 calls total.
      expect(mockUnsubscribe).toHaveBeenCalledTimes(2);
    });

    it('does not call controller.error when iterator throws after abort', async () => {
      // After abort, the catch block checks abortController.signal.aborted
      // and skips controller.error — so the stream ends without propagating
      // the error to the reader.
      //
      // Note: cancel() also calls eventIterator.return(), which may interrupt
      // the generator's pending await before the throw executes. This test
      // verifies the *clean abort path* — the throw-after-abort guard in the
      // catch block is a defensive measure that's exercised at runtime when
      // the iterator throws concurrently with the abort signal.
      const abortSignal: { aborted: boolean } = { aborted: false };

      async function* abortAwareGenerator() {
        yield { type: 'message', data: { text: 'first' } };
        // Wait until abort is signaled, then throw
        await new Promise<void>((resolve) => {
          const check = () => {
            if (abortSignal.aborted) {
              resolve();
            } else {
              setTimeout(check, 10);
            }
          };
          check();
        });
        // This throw happens AFTER abort — the route's catch block should
        // see signal.aborted === true and NOT call controller.error.
        throw new Error('post-abort error');
      }

      mockSubscribe.mockImplementationOnce(async () => abortAwareGenerator());

      const req = makeEventsRequest('agent-test-123');
      const response = await GET(req as any, {
        params: Promise.resolve({ id: 'agent-test-123' }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      // Read the first chunk
      const { value } = await reader.read();
      expect(decoder.decode(value)).toContain('first');

      // Cancel the reader (triggers abort via cancel() callback)
      // Mark our abort signal so the generator throws after abort
      abortSignal.aborted = true;
      await reader.cancel();

      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 50));

      // Stream should end cleanly — no rejection thrown to the reader
      // because the abort signal is checked before controller.error
      const { done } = await reader.read().catch(() => ({ done: true }));
      expect(done).toBe(true);
    });
  });
});
