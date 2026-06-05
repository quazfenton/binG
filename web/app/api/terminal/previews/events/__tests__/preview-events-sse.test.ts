/**
 * Unit tests for GET /api/terminal/previews/events — SSE preview stream
 *
 * Covers:
 *   - Authentication (401 without valid auth)
 *   - Initial snapshot format (with and without workspaceId)
 *   - Event filtering by workspaceId for all 4 event types
 *   - Heartbeat interval
 *   - Forced close after max duration
 *   - Listener cleanup on abort and cancel
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ============================================================================
// Mocks — vi.mock factories are hoisted to the top of the file BEFORE any
// variable declarations. Use vi.hoisted() for shared state.
// ============================================================================

// Mock resolveRequestAuth
vi.mock('@/lib/auth/request-auth', () => ({
  resolveRequestAuth: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock workspacePreviewRegistry — use vi.hoisted() so the emitter + stub
// functions exist when the mock factory runs. Must use require() for
// EventEmitter because static imports haven't resolved at hoist time.
const registryStateRef = vi.hoisted(() => {
  const { EventEmitter: EE } = require('node:events');
  const emitter = new EE();
  // Clear originalMaxListeners warning from Node
  emitter.setMaxListeners(100);
  return {
    emitter,
    statsFn: vi.fn().mockReturnValue({
      totalPreviews: 0,
      activePreviews: 0,
      unreachablePreviews: 0,
      byProvider: {},
    }),
    previewsFn: vi.fn().mockReturnValue([]),
  };
});

vi.mock('@/lib/terminal/workspace-preview-registry', () => ({
  workspacePreviewRegistry: Object.assign(registryStateRef.emitter, {
    getStats: registryStateRef.statsFn,
    getWorkspacePreviews: registryStateRef.previewsFn,
  }),
  WorkspacePreview: {} as any,
}));

// ============================================================================
// Imports
// ============================================================================

import { resolveRequestAuth } from '@/lib/auth/request-auth';

// ============================================================================
// Types
// ============================================================================

interface SSEEvent {
  event: string;
  data: any;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read events from an SSE ReadableStream and parse them.
 * Returns when maxEvents are collected, the stream ends, or signal is aborted.
 */
async function collectEvents(
  stream: ReadableStream<Uint8Array>,
  maxEvents: number = 10,
  signal?: AbortSignal,
): Promise<SSEEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events: SSEEvent[] = [];

  try {
    while (events.length < maxEvents) {
      if (signal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE chunks: event: xxx\ndata: {...}\n\n
      // Also handle heartbeat comments: : heartbeat\n\n
      const parts = buffer.split('\n\n');
      // Keep the last (possibly incomplete) part in the buffer
      buffer = parts.pop() || '';

      for (const part of parts) {
        if (!part.trim()) continue;
        // Skip comment-only lines (heartbeat)
        if (part.startsWith(':')) continue;

        const lines = part.split('\n');
        let eventName = '';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataStr = line.slice(6);
          }
        }

        if (eventName && dataStr) {
          try {
            events.push({ event: eventName, data: JSON.parse(dataStr) });
          } catch {
            // Malformed JSON in SSE — skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return events;
}

/**
 * Create a minimal WorkspacePreview-like object for testing.
 */
function makePreview(overrides: Record<string, any> = {}) {
  return {
    id: 'preview-1',
    workspaceId: 'ws-1',
    serviceId: 'svc-1',
    serviceName: 'nextjs',
    port: 3000,
    protocol: 'http',
    url: 'https://sandbox-123-3000.e2b.dev/',
    registeredAt: Date.now(),
    status: 'active',
    provider: 'e2b',
    sandboxId: 'sandbox-123',
    confidence: 'high',
    framework: 'nextjs',
    ...overrides,
  };
}

/**
 * Build a NextRequest for the SSE endpoint with optional query params and signal.
 */
function makeRequest(options: {
  workspaceId?: string;
  signal?: AbortSignal;
} = {}): NextRequest {
  let url = 'http://localhost/api/terminal/previews/events';
  if (options.workspaceId) {
    url += `?workspaceId=${encodeURIComponent(options.workspaceId)}`;
  }
  return new NextRequest(url, { signal: options.signal });
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/terminal/previews/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryStateRef.statsFn.mockReturnValue({
      totalPreviews: 0,
      activePreviews: 0,
      unreachablePreviews: 0,
      byProvider: {},
    });
    registryStateRef.previewsFn.mockReturnValue([]);
    registryStateRef.emitter.removeAllListeners();
  });

  // ========================================================================
  // 1. Authentication
  // ========================================================================

  describe('authentication', () => {
    it('returns 401 when resolveRequestAuth fails', async () => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: false,
        error: 'Unauthorized',
      });

      const res = await (await import('../route')).GET(makeRequest());

      expect(res.status).toBe(401);
      const body = await res.text();
      expect(body).toBe('Unauthorized');
    });

    it('returns 401 when resolveRequestAuth succeeds but has no userId', async () => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: null,
      });

      const res = await (await import('../route')).GET(makeRequest());

      expect(res.status).toBe(401);
    });

    it('returns 200 with SSE headers when auth succeeds', async () => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });

      const res = await (await import('../route')).GET(makeRequest());

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache, no-transform');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    });
  });

  // ========================================================================
  // 2. Initial snapshot
  // ========================================================================

  describe('initial snapshot', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('sends preview:initial with global stats when no workspaceId', async () => {
      registryStateRef.statsFn.mockReturnValue({
        totalPreviews: 5,
        activePreviews: 3,
        unreachablePreviews: 1,
        byProvider: { e2b: 4, codesandbox: 1 },
      });

      const res = await (await import('../route')).GET(makeRequest());
      const events = await collectEvents(res.body!, 1);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('preview:initial');
      expect(events[0].data.workspaceId).toBeNull();
      expect(events[0].data.previews).toEqual([]);
      expect(events[0].data.stats.totalPreviews).toBe(5);
      expect(events[0].data.stats.activePreviews).toBe(3);
    });

    it('sends preview:initial with workspace previews when workspaceId provided', async () => {
      const mockPreviews = [
        makePreview({ id: 'p-1', workspaceId: 'ws-target', serviceName: 'nextjs' }),
        makePreview({ id: 'p-2', workspaceId: 'ws-target', serviceName: 'flask', status: 'starting' }),
      ];
      registryStateRef.previewsFn.mockReturnValue(mockPreviews);

      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-target' }));
      const events = await collectEvents(res.body!, 1);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('preview:initial');
      expect(events[0].data.workspaceId).toBe('ws-target');
      expect(events[0].data.previews).toHaveLength(2);
      expect(events[0].data.activeCount).toBe(1); // only p-1 is active
      expect(events[0].data.totalCount).toBe(2);
      expect(events[0].data.stats).toBeUndefined();
    });

    it('sends preview:initial with zero previews for empty workspace', async () => {
      registryStateRef.previewsFn.mockReturnValue([]);

      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-empty' }));
      const events = await collectEvents(res.body!, 1);

      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('preview:initial');
      expect(events[0].data.workspaceId).toBe('ws-empty');
      expect(events[0].data.previews).toHaveLength(0);
      expect(events[0].data.activeCount).toBe(0);
      expect(events[0].data.totalCount).toBe(0);
    });
  });

  // ========================================================================
  // 3. Event streaming and workspaceId filtering
  // ========================================================================

  describe('event streaming', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('streams preview:registered for matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-match' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Read initial snapshot
      await reader.read();

      // Emit matching event
      registryStateRef.emitter.emit('preview:registered', makePreview({
        workspaceId: 'ws-match',
        id: 'match-1',
      }));

      // Read the event
      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('event: preview:registered');
      expect(chunk).toContain('match-1');

      reader.releaseLock();
    });

    it('filters out preview:registered for non-matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-match' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Read initial snapshot
      await reader.read();

      // Emit non-matching event (should be silently filtered)
      registryStateRef.emitter.emit('preview:registered', makePreview({
        workspaceId: 'ws-other',
        id: 'nomatch-1',
      }));

      // Emit a matching event — should still arrive after the filtered one
      registryStateRef.emitter.emit('preview:registered', makePreview({
        workspaceId: 'ws-match',
        id: 'match-after-filter',
      }));

      // Read the matching event — only it should arrive
      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('match-after-filter');
      expect(chunk).not.toContain('nomatch-1');

      reader.releaseLock();
    });

    it('streams preview:updated for matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-target' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      registryStateRef.emitter.emit('preview:updated', makePreview({
        workspaceId: 'ws-target',
        id: 'updated-match',
        status: 'active',
      }));

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('event: preview:updated');
      expect(chunk).toContain('updated-match');

      reader.releaseLock();
    });

    it('streams preview:removed for matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-target' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      registryStateRef.emitter.emit('preview:removed', {
        preview: makePreview({ workspaceId: 'ws-target', id: 'removed-match' }),
        workspaceId: 'ws-target',
      });

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('event: preview:removed');
      expect(chunk).toContain('removed-match');

      reader.releaseLock();
    });

    it('streams workspace:cleared for matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-target' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-target' });

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('event: workspace:cleared');
      expect(chunk).toContain('ws-target');

      reader.releaseLock();
    });

    it('filters out preview:updated for non-matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-filter' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      // Emit non-matching updated event (should be filtered)
      registryStateRef.emitter.emit('preview:updated', makePreview({
        workspaceId: 'ws-other',
        id: 'updated-nomatch',
      }));

      // Emit matching updated event (should arrive)
      registryStateRef.emitter.emit('preview:updated', makePreview({
        workspaceId: 'ws-filter',
        id: 'updated-match',
      }));

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('updated-match');
      expect(chunk).not.toContain('updated-nomatch');

      reader.releaseLock();
    });

    it('filters out preview:removed for non-matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-filter' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      // Emit non-matching removed event (should be filtered)
      registryStateRef.emitter.emit('preview:removed', {
        preview: makePreview({ workspaceId: 'ws-other', id: 'removed-nomatch' }),
        workspaceId: 'ws-other',
      });

      // Emit matching removed event (should arrive)
      registryStateRef.emitter.emit('preview:removed', {
        preview: makePreview({ workspaceId: 'ws-filter', id: 'removed-match' }),
        workspaceId: 'ws-filter',
      });

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('removed-match');
      expect(chunk).not.toContain('removed-nomatch');

      reader.releaseLock();
    });

    it('filters out workspace:cleared for non-matching workspaceId', async () => {
      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-filter' }));
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      await reader.read(); // initial snapshot

      // Emit non-matching cleared event (should be filtered)
      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-other' });

      // Emit matching cleared event (should arrive)
      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-filter' });

      const { value } = await reader.read();
      const chunk = decoder.decode(value);
      expect(chunk).toContain('ws-filter');

      reader.releaseLock();
    });

    it('streams all event types when no workspaceId filter', async () => {
      const res = await (await import('../route')).GET(makeRequest());

      // Emit all 4 event types BEFORE reading so they're buffered in the stream
      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'all-reg' }));
      registryStateRef.emitter.emit('preview:updated', makePreview({ id: 'all-upd' }));
      registryStateRef.emitter.emit('preview:removed', {
        preview: makePreview({ id: 'all-rem' }),
        workspaceId: 'ws-1',
      });
      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-1' });

      // Now read all 5 events (1 initial + 4 emitted)
      const events = await collectEvents(res.body!, 5);

      expect(events).toHaveLength(5);
      const eventTypes = events.map(e => e.event);
      expect(eventTypes).toContain('preview:initial');
      expect(eventTypes).toContain('preview:registered');
      expect(eventTypes).toContain('preview:updated');
      expect(eventTypes).toContain('preview:removed');
      expect(eventTypes).toContain('workspace:cleared');
    });
  });

  // ========================================================================
  // 4. Heartbeat
  // ========================================================================

  describe('heartbeat', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('sends heartbeat comments every 30 seconds', async () => {
      vi.useFakeTimers();

      try {
        const res = await (await import('../route')).GET(makeRequest());
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        // Read initial snapshot
        await reader.read();

        // Advance 30s — heartbeat should fire
        vi.advanceTimersByTime(30_000);

        const { value: hb1 } = await reader.read();
        expect(decoder.decode(hb1)).toContain(': heartbeat');

        // Advance another 30s
        vi.advanceTimersByTime(30_000);

        const { value: hb2 } = await reader.read();
        expect(decoder.decode(hb2)).toContain(': heartbeat');

        reader.releaseLock();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ========================================================================
  // 5. Forced close after max duration
  // ========================================================================

  describe('forced close', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('cleans up registry listeners after 30 minutes', async () => {
      vi.useFakeTimers();

      try {
        const res = await (await import('../route')).GET(makeRequest());
        const reader = res.body!.getReader();

        // Read initial snapshot
        await reader.read();

        // Verify listeners are registered before forced close
        expect(registryStateRef.emitter.listenerCount('preview:registered')).toBe(1);
        expect(registryStateRef.emitter.listenerCount('preview:updated')).toBe(1);
        expect(registryStateRef.emitter.listenerCount('preview:removed')).toBe(1);
        expect(registryStateRef.emitter.listenerCount('workspace:cleared')).toBe(1);

        // Advance past 30 min so the forced close timer fires
        vi.advanceTimersByTime(30 * 60 * 1000 + 100);

        // The forced close timer callback runs cleanupFn which removes all
        // registry listeners and clears the heartbeat interval + timer.
        expect(registryStateRef.emitter.listenerCount('preview:registered')).toBe(0);
        expect(registryStateRef.emitter.listenerCount('preview:updated')).toBe(0);
        expect(registryStateRef.emitter.listenerCount('preview:removed')).toBe(0);
        expect(registryStateRef.emitter.listenerCount('workspace:cleared')).toBe(0);

        // Emitting events after cleanup should not crash (no listeners remain)
        registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-close' }));

        reader.releaseLock();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ========================================================================
  // 6. Listener cleanup
  // ========================================================================

  describe('listener cleanup', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('removes registry listeners on abort', async () => {
      const controller = new AbortController();
      const res = await (await import('../route')).GET(makeRequest({ signal: controller.signal }));
      const reader = res.body!.getReader();

      // Read initial snapshot
      await reader.read();

      // Abort the connection — triggers req.signal abort handler
      controller.abort();

      // After abort, emit events on the registry — they should NOT reach the stream
      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-abort-1' }));
      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-abort-2' }));

      // Emit a matching event — should NOT arrive because listeners were removed
      registryStateRef.emitter.emit('preview:registered', makePreview({
        workspaceId: 'workspace',
        id: 'after-abort-check',
      }));

      // Verify no listeners remain on the registry
      expect(registryStateRef.emitter.listenerCount('preview:registered')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('preview:updated')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('preview:removed')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('workspace:cleared')).toBe(0);

      reader.releaseLock();
    });

    it('removes registry listeners on stream cancel', async () => {
      const res = await (await import('../route')).GET(makeRequest());
      const reader = res.body!.getReader();

      // Read initial snapshot
      await reader.read();

      // Cancel the stream — triggers ReadableStream cancel()
      await reader.cancel();

      // Emit events — should not reach anything (stream is cancelled)
      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-cancel-1' }));
      registryStateRef.emitter.emit('preview:updated', makePreview({ id: 'after-cancel-2' }));

      // No crash = cleanup ran successfully
      // Verify by checking that the emitter still works (no error from removed handlers)
      expect(registryStateRef.emitter.listenerCount('preview:registered')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('preview:updated')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('preview:removed')).toBe(0);
      expect(registryStateRef.emitter.listenerCount('workspace:cleared')).toBe(0);
    });
  });

  // ========================================================================
  // 7. Edge cases: initial snapshot from getWorkspacePreviews
  // ========================================================================

  describe('initial snapshot calls getWorkspacePreviews with correct workspaceId', () => {
    beforeEach(() => {
      (resolveRequestAuth as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        userId: 'user-123',
        source: 'jwt',
      });
    });

    it('calls getWorkspacePreviews with the provided workspaceId', async () => {
      registryStateRef.previewsFn.mockReturnValue([makePreview({ id: 'p-1', workspaceId: 'ws-custom' })]);

      const res = await (await import('../route')).GET(makeRequest({ workspaceId: 'ws-custom' }));
      const events = await collectEvents(res.body!, 1);

      expect(events).toHaveLength(1);
      expect(events[0].data.workspaceId).toBe('ws-custom');
      expect(registryStateRef.previewsFn).toHaveBeenCalledWith('ws-custom');
    });
  });
});
