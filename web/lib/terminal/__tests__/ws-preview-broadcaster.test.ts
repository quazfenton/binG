/**
 * Unit tests for WsPreviewBroadcaster
 *
 * Verifies core broadcaster behaviors:
 *   - broadcast sends messages to all connected clients
 *   - handleConnection rejects invalid tokens in production
 *   - unsubscribeFromRegistry fires when last client disconnects
 *   - dead clients are cleaned up by the ping interval
 *   - workspace filtering works correctly
 *   - subscribe/unsubscribe message handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// EventEmitter is needed only in mock factories (which use require() for
// hoisting reasons). The top-level import below is kept for TypeScript
// type-checking of the createBroadcaster helper's return type.

// ============================================================================
// Mocks — vi.mock factories are hoisted to the top of the file BEFORE any
// variable declarations. Use `vi.hoisted()` to create state that must be
// accessible inside mock factories and from test code.
// ============================================================================

// Mock the 'ws' module — must use require() for EventEmitter since
// hoisted mock factories run before static imports are resolved.
vi.mock('ws', () => {
  const { EventEmitter: EE } = require('node:events');
  class MockWSS extends EE {
    close = vi.fn();
  }

  return {
    WebSocketServer: MockWSS,
    WebSocket: {
      OPEN: 1,
      CLOSED: 2,
      CLOSING: 3,
      CONNECTING: 0,
    },
  };
});

// Mock logger
vi.mock('@/lib/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock JWT auth — use vi.hoisted() so the fn ref is available in the mock factory
const mockVerifyTokenRef = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/security/jwt-auth', () => ({
  verifyToken: (...args: any[]) => mockVerifyTokenRef.fn(...args),
}));

// Mock workspacePreviewRegistry — use vi.hoisted() so the emitter and stub
// functions exist when the mock factory runs. Must use require() for
// EventEmitter because static imports haven't resolved yet at hoist time.
const registryStateRef = vi.hoisted(() => {
  const { EventEmitter: EE } = require('node:events');
  return {
    emitter: new EE(),
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

// Mock preview-router
vi.mock('@/lib/previews/preview-router', () => ({
  previewRouter: {
    registerPreview: vi.fn().mockResolvedValue(undefined),
    unregisterPreview: vi.fn().mockResolvedValue(undefined),
  },
}));

// ============================================================================
// Imports
// ============================================================================

import { WebSocketServer } from 'ws';
import {
  WsPreviewBroadcaster,
} from '@/lib/terminal/ws-preview-broadcaster';
import type { WorkspacePreview } from '@/lib/terminal/workspace-preview-registry';

// Grab the real WebSocket constants for accurate readyState values
const { WebSocket: WsConst } = await vi.importActual<typeof import('ws')>('ws');
const WsConstActual = WsConst as unknown as { OPEN: number; CLOSED: number; CLOSING: number };

// ============================================================================
// Types
// ============================================================================

interface MockWebSocket {
  readyState: number;
  sent: string[];
  closed: { code: number; reason: string } | null;
  terminated: boolean;
  listeners: Map<string, Set<(...args: any[]) => void>>;
}

// ============================================================================
// Helpers
// ============================================================================

function createMockWebSocket(readyState = WsConstActual.OPEN): MockWebSocket {
  return {
    readyState,
    sent: [],
    closed: null,
    terminated: false,
    listeners: new Map(),
  };
}

function mockWsOn(ws: MockWebSocket, event: string, handler: (...args: any[]) => void) {
  if (!ws.listeners.has(event)) ws.listeners.set(event, new Set());
  ws.listeners.get(event)!.add(handler);
}

function mockWsEmit(ws: MockWebSocket, event: string, ...args: any[]) {
  ws.listeners.get(event)?.forEach(h => h(...args));
}

function makePreview(overrides: Partial<WorkspacePreview> = {}): WorkspacePreview {
  return {
    id: 'preview-1',
    workspaceId: 'ws-1',
    serviceId: 'svc-1',
    serviceName: 'nextjs',
    port: 3000,
    protocol: 'http' as const,
    url: 'https://sandbox-123-3000.e2b.dev/',
    registeredAt: Date.now(),
    status: 'active' as const,
    provider: 'e2b' as const,
    sandboxId: 'sandbox-123',
    confidence: 'high' as const,
    framework: 'nextjs',
    ...overrides,
  };
}

/** Simulate a new client connecting. Returns the mock WebSocket and its raw proxy. */
function simulateConnection(
  broadcaster: WsPreviewBroadcaster,
  mockWss: EventEmitter,
  token?: string,
  wsReadyState: number = WsConstActual.OPEN,
): { ws: MockWebSocket; rawWs: any } {
  const mockWs = createMockWebSocket(wsReadyState);

  const rawWs = {
    // Use a getter so the broadcaster's pinger sees live readyState changes
    // (e.g., when close() transitions the socket to CLOSED).
    get readyState() { return mockWs.readyState; },
    send: vi.fn((data: string) => mockWs.sent.push(data)),
    close: vi.fn((code: number, reason: string) => {
      mockWs.closed = { code, reason };
      mockWs.readyState = WsConstActual.CLOSED;
    }),
    terminate: vi.fn(() => { mockWs.terminated = true; }),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      mockWsOn(mockWs, event, handler);
    }),
    ping: vi.fn(),
  };

  const req = {
    headers: { 'x-forwarded-for': '127.0.0.1' },
    socket: { remoteAddress: '127.0.0.1' },
  };

  // Trigger the 'connection' event on the WSS
  mockWss.emit('connection', rawWs, req, { token: token ?? null });
  return { ws: mockWs, rawWs };
}

/** Create a fresh broadcaster attached to a fresh mock WSS. */
function createBroadcaster(): { broadcaster: WsPreviewBroadcaster; wss: EventEmitter } {
  const broadcaster = new WsPreviewBroadcaster();
  const wss = new (WebSocketServer as any)() as EventEmitter;

  wss.removeAllListeners();
  broadcaster.attachToServer(wss as any);
  return { broadcaster, wss };
}

// ============================================================================
// Tests
// ============================================================================

describe('WsPreviewBroadcaster', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    mockVerifyTokenRef.fn.mockReset();
    registryStateRef.statsFn.mockReturnValue({
      totalPreviews: 0,
      activePreviews: 0,
      unreachablePreviews: 0,
      byProvider: {},
    });
    registryStateRef.previewsFn.mockReturnValue([]);
    registryStateRef.emitter.removeAllListeners();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  // ========================================================================
  // 1. broadcast sends to all connected clients
  // ========================================================================

  describe('broadcast', () => {
    it('should send a message to all connected clients', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      const c2 = simulateConnection(broadcaster, wss);
      const c3 = simulateConnection(broadcaster, wss);

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(3);
      });

      const preview = makePreview({ id: 'preview-test', serviceName: 'vite-dev' });
      registryStateRef.emitter.emit('preview:registered', preview);

      // All 3 clients should have received the broadcast
      expect(c1.rawWs.send).toHaveBeenCalled();
      expect(c2.rawWs.send).toHaveBeenCalled();
      expect(c3.rawWs.send).toHaveBeenCalled();

      const broadcastCalls1 = c1.rawWs.send.mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(broadcastCalls1).toHaveLength(1);
      const msg = JSON.parse(broadcastCalls1[0][0]);
      expect(msg.type).toBe('preview:registered');
      expect(msg.payload.id).toBe('preview-test');
      expect(msg.payload.serviceName).toBe('vite-dev');
      expect(typeof msg.timestamp).toBe('number');
    });

    it('should NOT send to clients with closed WebSocket connections', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      const c2 = simulateConnection(broadcaster, wss, undefined, WsConstActual.CLOSED);

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(2);
      });

      registryStateRef.emitter.emit('preview:registered', makePreview());

      const c1Broadcasts = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      const c2Broadcasts = (c2.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(c1Broadcasts).toHaveLength(1);
      expect(c2Broadcasts).toHaveLength(0);
    });

    it('should filter events by workspace when client has subscriptions', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(
        c1.ws,
        'message',
        Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-1' })),
      );

      // Event for ws-1 should be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-1' }));
      const ws1Broadcasts = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(ws1Broadcasts).toHaveLength(1);

      // Event for ws-2 should NOT be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-2' }));
      const ws2Broadcasts = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => {
          const m = JSON.parse(call[0]);
          return m.type === 'preview:registered' && m.payload.workspaceId === 'ws-2';
        }
      );
      expect(ws2Broadcasts).toHaveLength(0);
    });
  });

  // ========================================================================
  // 2. handleConnection rejects invalid tokens
  // ========================================================================

  describe('authentication', () => {
    it('should reject connections with invalid tokens in production', async () => {
      process.env.NODE_ENV = 'production';

      const { broadcaster, wss } = createBroadcaster();
      mockVerifyTokenRef.fn.mockResolvedValue({ valid: false });

      const { rawWs } = simulateConnection(broadcaster, wss, 'bad-token');

      await vi.waitFor(() => {
        expect(rawWs.close).toHaveBeenCalled();
      });

      expect(rawWs.close).toHaveBeenCalledWith(
        4001,
        'Authentication required for preview dashboard',
      );
      expect(broadcaster.getConnectedClients()).toBe(0);
    });

    it('should reject connections when verifyToken throws', async () => {
      process.env.NODE_ENV = 'production';

      const { broadcaster, wss } = createBroadcaster();
      mockVerifyTokenRef.fn.mockRejectedValue(new Error('Auth service unavailable'));

      const { rawWs } = simulateConnection(broadcaster, wss, 'some-token');

      await vi.waitFor(() => {
        expect(rawWs.close).toHaveBeenCalled();
      });

      expect(rawWs.close).toHaveBeenCalledWith(
        4001,
        'Authentication required for preview dashboard',
      );
    });

    it('should accept connections without tokens in development', async () => {
      process.env.NODE_ENV = 'development';

      const { broadcaster, wss } = createBroadcaster();
      const { rawWs } = simulateConnection(broadcaster, wss, undefined);

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(1);
      });

      expect(rawWs.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    });

    it('should accept connections with valid tokens in production', async () => {
      process.env.NODE_ENV = 'production';

      const { broadcaster, wss } = createBroadcaster();
      mockVerifyTokenRef.fn.mockResolvedValue({
        valid: true,
        payload: { userId: 'user-123', sub: 'user-123' },
      });

      const { rawWs } = simulateConnection(broadcaster, wss, 'valid-token');

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(1);
      });

      expect(rawWs.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    });

    it('should accept valid token when payload uses "sub" for userId', async () => {
      process.env.NODE_ENV = 'production';

      const { broadcaster, wss } = createBroadcaster();
      mockVerifyTokenRef.fn.mockResolvedValue({
        valid: true,
        payload: { sub: 'user-sub-456' },
      });

      const { rawWs } = simulateConnection(broadcaster, wss, 'token-with-sub');

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(1);
      });

      expect(rawWs.close).not.toHaveBeenCalledWith(4001, expect.any(String));
    });

    it('should reject connections when client limit is reached', async () => {
      process.env.NODE_ENV = 'development';

      // Override MAX_CLIENTS via env — must be set before constructing the broadcaster
      process.env.MAX_PREVIEW_WS_CLIENTS = '1';
      const broadcaster2 = new WsPreviewBroadcaster();
      const wss2 = new (WebSocketServer as any)() as EventEmitter;
      wss2.removeAllListeners();
      broadcaster2.attachToServer(wss2 as any);

      const c1 = simulateConnection(broadcaster2, wss2);
      await vi.waitFor(() => expect(broadcaster2.getConnectedClients()).toBe(1));

      const { rawWs: rawWs2 } = simulateConnection(broadcaster2, wss2);
      await vi.waitFor(() => {
        expect(rawWs2.close).toHaveBeenCalled();
      });

      expect(rawWs2.close).toHaveBeenCalledWith(
        4004,
        'Too many preview dashboard connections',
      );
      expect(broadcaster2.getConnectedClients()).toBe(1);

      delete process.env.MAX_PREVIEW_WS_CLIENTS;
    });
  });

  // ========================================================================
  // 3. unsubscribe fires when last client disconnects
  // ========================================================================

  describe('registry subscription lifecycle', () => {
    it('should subscribe to registry on first client and unsubscribe on last disconnect', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Verify registry IS subscribed — broadcasts work
      const preview = makePreview({ id: 'test-lifecycle' });
      registryStateRef.emitter.emit('preview:registered', preview);
      await vi.waitFor(() => {
        expect(c1.rawWs.send).toHaveBeenCalled();
      });

      // Disconnect the last client → should trigger unsubscribeFromRegistry
      mockWsEmit(c1.ws, 'close', 1000, Buffer.from('client disconnect'));
      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(0);
      });

      // After last client leaves, verify no listeners remain on the registry
      // by checking that emitting an event does NOT cause any send calls
      // (the registry listener was removed, so broadcast is never called).
      const afterUnsubPreview = makePreview({ id: 'test-after-unsub' });
      // Clear send history so we can detect new calls
      c1.rawWs.send.mockClear();
      registryStateRef.emitter.emit('preview:registered', afterUnsubPreview);

      // No send calls should have been made because the listener is gone
      expect(c1.rawWs.send).not.toHaveBeenCalled();
    });

    it('should NOT unsubscribe when one client disconnects but others remain', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      const c2 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(2));

      mockWsEmit(c1.ws, 'close', 1000, Buffer.from('disconnect'));
      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(1);
      });

      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-c1-left' }));
      await vi.waitFor(() => {
        const broadcasts = (c2.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(broadcasts).toHaveLength(1);
      });
    });

    it('should resubscribe when a new client connects after all disconnected', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));
      mockWsEmit(c1.ws, 'close', 1000, Buffer.from('gone'));
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(0));

      const c2 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      registryStateRef.emitter.emit('preview:registered', makePreview({ id: 'after-resub' }));
      await vi.waitFor(() => {
        const broadcasts = (c2.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(broadcasts).toHaveLength(1);
      });
    });
  });

  // ========================================================================
  // 4. dead clients are cleaned up
  // ========================================================================

  describe('dead client cleanup', () => {
    it('should clean up clients with expired pong timeout', async () => {
      vi.useFakeTimers();

      const { broadcaster, wss } = createBroadcaster();

      const { rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Advance past PONG_TIMEOUT_MS (60s) so lastPong is stale
      vi.advanceTimersByTime(61_000);
      // Advance past PING_INTERVAL_MS (30s) to trigger the interval callback
      vi.advanceTimersByTime(30_001);

      await vi.waitFor(() => {
        expect(rawWs.terminate).toHaveBeenCalled();
      });

      expect(broadcaster.getConnectedClients()).toBe(0);

      vi.useRealTimers();
    });

    it('should clean up clients whose WebSocket is in CLOSED state', async () => {
      vi.useFakeTimers();

      const { broadcaster, wss } = createBroadcaster();

      const { rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Close the WebSocket directly — this transitions readyState to CLOSED
      // via the getter on rawWs, so the pinger sees the updated state.
      rawWs.close(1006, 'Abnormal closure');
      expect(rawWs.readyState).toBe(WsConstActual.CLOSED);

      // Advance past PING_INTERVAL_MS to trigger the interval
      vi.advanceTimersByTime(30_001);

      // The pinger should detect CLOSED readyState and clean up
      await vi.waitFor(() => {
        expect(rawWs.terminate).toHaveBeenCalled();
      });

      expect(broadcaster.getConnectedClients()).toBe(0);

      vi.useRealTimers();
    });

    it('should NOT clean up clients that respond to pings', async () => {
      vi.useFakeTimers();

      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Client sends pong — updates lastPong
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'pong' })));

      // Advance past PING_INTERVAL but well within PONG_TIMEOUT
      vi.advanceTimersByTime(30_001);

      expect(rawWs.terminate).not.toHaveBeenCalled();
      expect(broadcaster.getConnectedClients()).toBe(1);

      vi.useRealTimers();
    });
  });

  // ========================================================================
  // 5. Message handling (subscribe/unsubscribe/pong)
  // ========================================================================

  describe('message handling', () => {
    it('should handle subscribe message with valid workspaceId', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(
        mockWs,
        'message',
        Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-target' })),
      );

      await vi.waitFor(() => {
        const snapshotCalls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:workspace-snapshot'
        );
        expect(snapshotCalls).toHaveLength(1);
        const snapshot = JSON.parse(snapshotCalls[0][0]);
        expect(snapshot.workspaceId).toBe('ws-target');
      });
    });

    it('should handle unsubscribe message', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-1' })));
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'unsubscribe', workspaceId: 'ws-1' })));

      // After unsubscribing, events should pass through (no filter)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-1' }));
      await vi.waitFor(() => {
        const broadcasts = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(broadcasts).toHaveLength(1);
      });
    });

    it('should handle pong message by updating lastPong', async () => {
      vi.useFakeTimers();

      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'pong' })));
      vi.advanceTimersByTime(30_001);

      expect(rawWs.terminate).not.toHaveBeenCalled();
      expect(broadcaster.getConnectedClients()).toBe(1);

      vi.useRealTimers();
    });

    it('should ignore malformed JSON messages', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'message', Buffer.from('not-json{'));
      expect(broadcaster.getConnectedClients()).toBe(1);
    });
  });

  // ========================================================================
  // 6. Initial state on connect
  // ========================================================================

  describe('initial state on connect', () => {
    it('should send initial-state snapshot to newly connected clients', async () => {
      const { broadcaster, wss } = createBroadcaster();

      registryStateRef.statsFn.mockReturnValue({
        totalPreviews: 5,
        activePreviews: 3,
        unreachablePreviews: 1,
        byProvider: { e2b: 4, codesandbox: 1 },
      });

      const { rawWs } = simulateConnection(broadcaster, wss);

      await vi.waitFor(() => {
        const initialCalls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:initial-state'
        );
        expect(initialCalls).toHaveLength(1);
        const payload = JSON.parse(initialCalls[0][0]);
        expect(payload.type).toBe('preview:initial-state');
        expect(payload.stats.totalPreviews).toBe(5);
        expect(payload.stats.activePreviews).toBe(3);
        expect(typeof payload.timestamp).toBe('number');
      });
    });
  });

  // ========================================================================
  // 7. Error handling
  // ========================================================================

  describe('error handling', () => {
    it('should remove client from set on WebSocket error', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'error', new Error('Connection reset'));

      await vi.waitFor(() => {
        expect(broadcaster.getConnectedClients()).toBe(0);
      });
    });
  });

  // ========================================================================
  // 8. shutdown
  // ========================================================================

  describe('shutdown', () => {
    it('should close all client connections and clear state', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      const c2 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(2));

      broadcaster.shutdown();

      expect(broadcaster.getConnectedClients()).toBe(0);
      expect(c1.rawWs.close).toHaveBeenCalledWith(4001, 'Server shutting down');
      expect(c2.rawWs.close).toHaveBeenCalledWith(4001, 'Server shutting down');
    });

    it('attachToServer should be idempotent', () => {
      const { broadcaster, wss } = createBroadcaster();

      broadcaster.attachToServer(wss as any);

      expect(broadcaster.getConnectedClients()).toBe(0);
    });
  });

  // ========================================================================
  // 9. All 4 event types are broadcast correctly
  // ========================================================================

  describe('event type broadcasting', () => {
    it('should broadcast preview:updated events', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      const preview = makePreview({ id: 'updated-preview', status: 'active' });
      registryStateRef.emitter.emit('preview:updated', preview);

      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:updated'
        );
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0][0]).payload.status).toBe('active');
      });
    });

    it('should broadcast preview:removed events', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      const preview = makePreview({ id: 'removed-preview' });
      const payload = { preview, workspaceId: 'ws-1' };
      registryStateRef.emitter.emit('preview:removed', payload);

      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:removed'
        );
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0][0]).payload.preview.id).toBe('removed-preview');
      });
    });

    it('should broadcast workspace:cleared events', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-cleared' });

      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'workspace:cleared'
        );
        expect(calls).toHaveLength(1);
        expect(JSON.parse(calls[0][0]).payload.workspaceId).toBe('ws-cleared');
      });
    });
  });

  // ========================================================================
  // 10. Workspace subscriptions
  // ========================================================================

  describe('workspace subscriptions', () => {
    it('should add workspaceId to subscribed set on subscribe message', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe to ws-a
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));

      // Event for ws-a should be received (it matched the subscription)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'p-wsa' }));
      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(calls).toHaveLength(1);
      });
    });

    it('should send workspace snapshot on subscribe', async () => {
      const { broadcaster, wss } = createBroadcaster();

      // Set up mock previews in the registry for the subscribed workspace
      registryStateRef.previewsFn.mockReturnValue([
        makePreview({ id: 'p-1', workspaceId: 'ws-snap', serviceName: 'nextjs', port: 3000 }),
        makePreview({ id: 'p-2', workspaceId: 'ws-snap', serviceName: 'flask', port: 5000 }),
      ]);

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-snap' })));

      // Should receive workspace-snapshot with both previews
      await vi.waitFor(() => {
        const snapCalls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:workspace-snapshot'
        );
        expect(snapCalls).toHaveLength(1);
        const snap = JSON.parse(snapCalls[0][0]);
        expect(snap.workspaceId).toBe('ws-snap');
        expect(snap.previews).toHaveLength(2);
        expect(snap.activeCount).toBe(2);
        expect(snap.totalCount).toBe(2);
        expect(typeof snap.timestamp).toBe('number');
      });
    });

    it('should remove workspaceId from subscribed set on unsubscribe', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe to ws-a
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));
      // Unsubscribe from ws-a
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'unsubscribe', workspaceId: 'ws-a' })));

      // After unsubscribing, events for ws-a should arrive (filter removed)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'after-unsub' }));
      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(calls).toHaveLength(1);
      });
    });

    it('should filter events to only matching workspace subscriptions', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe to ws-a only
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));

      // Emit event for ws-a → should be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'match-1' }));
      const matchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => {
          const m = JSON.parse(call[0]);
          return m.type === 'preview:registered' && m.payload.id === 'match-1';
        }
      );
      expect(matchCalls).toHaveLength(1);

      // Emit event for ws-b → should NOT be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-b', id: 'nomatch-1' }));
      const noMatchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => {
          const m = JSON.parse(call[0]);
          return m.type === 'preview:registered' && m.payload.id === 'nomatch-1';
        }
      );
      expect(noMatchCalls).toHaveLength(0);
    });

    it('should receive all events when subscribedWorkspaces is empty (no filter)', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Client has no subscriptions → should receive events for any workspace
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'p-a' }));
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-b', id: 'p-b' }));
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-c', id: 'p-c' }));

      await vi.waitFor(() => {
        const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(calls).toHaveLength(3);
      });
    });

    it('should support subscribing to multiple workspaces', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe to both ws-a and ws-b
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));
      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-b' })));

      // Both should be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'p-a' }));
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-b', id: 'p-b' }));
      // ws-c should NOT be received
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-c', id: 'p-c' }));

      const calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(calls).toHaveLength(2);
      const receivedIds = calls.map((c: any) => JSON.parse(c[0]).payload.id);
      expect(receivedIds).toContain('p-a');
      expect(receivedIds).toContain('p-b');
      expect(receivedIds).not.toContain('p-c');
    });

    it('should not crash on subscribe with missing workspaceId', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe with no workspaceId
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe' })));

      // Should still receive all events (no filter applied)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-x', id: 'p-x' }));
      await vi.waitFor(() => {
        const calls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(calls).toHaveLength(1);
      });
    });

    it('should not crash on unsubscribe with missing workspaceId', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Unsubscribe with no workspaceId
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'unsubscribe' })));

      // No crash, should still work
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-x', id: 'p-x' }));
      await vi.waitFor(() => {
        const calls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
          (call: any) => JSON.parse(call[0]).type === 'preview:registered'
        );
        expect(calls).toHaveLength(1);
      });
    });

    it('should be idempotent: subscribing twice to same workspace sends snapshot each time', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      // Subscribe twice to same workspace
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-dup' })));
      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-dup' })));

      // Should have 2 snapshot calls (one per subscribe)
      const snapCalls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:workspace-snapshot'
      );
      expect(snapCalls).toHaveLength(2);
    });

    it('should accept subscribe to a workspace that has no previews', async () => {
      const { broadcaster, wss } = createBroadcaster();

      // Mock empty previews
      registryStateRef.previewsFn.mockReturnValue([]);

      const { ws: mockWs, rawWs } = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(mockWs, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-empty' })));

      // Snapshot should still be sent, just with empty previews
      const snapCalls = (rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:workspace-snapshot'
      );
      expect(snapCalls).toHaveLength(1);
      const snap = JSON.parse(snapCalls[0][0]);
      expect(snap.workspaceId).toBe('ws-empty');
      expect(snap.previews).toHaveLength(0);
      expect(snap.activeCount).toBe(0);
      expect(snap.totalCount).toBe(0);
    });

    it('should filter preview:updated events by workspace subscription', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));

      // Updated for ws-a should arrive
      registryStateRef.emitter.emit('preview:updated', makePreview({ workspaceId: 'ws-a', id: 'updated-match' }));
      const matchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => {
          const m = JSON.parse(call[0]);
          return m.type === 'preview:updated' && m.payload.id === 'updated-match';
        }
      );
      expect(matchCalls).toHaveLength(1);

      // Updated for ws-b should NOT arrive
      registryStateRef.emitter.emit('preview:updated', makePreview({ workspaceId: 'ws-b', id: 'updated-nomatch' }));
      const noMatchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => {
          const m = JSON.parse(call[0]);
          return m.type === 'preview:updated' && m.payload.id === 'updated-nomatch';
        }
      );
      expect(noMatchCalls).toHaveLength(0);
    });

    it('should filter preview:removed events by workspace subscription', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-sub' })));

      // Removed for ws-sub should arrive
      const previewSub = makePreview({ workspaceId: 'ws-sub', id: 'rem-match' });
      registryStateRef.emitter.emit('preview:removed', { preview: previewSub, workspaceId: 'ws-sub' });
      const matchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:removed'
      );
      expect(matchCalls).toHaveLength(1);

      // Removed for ws-other should NOT arrive
      const previewOther = makePreview({ workspaceId: 'ws-other', id: 'rem-nomatch' });
      registryStateRef.emitter.emit('preview:removed', { preview: previewOther, workspaceId: 'ws-other' });
      const remainCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:removed'
      );
      expect(remainCalls).toHaveLength(1); // still just the first one
    });

    it('should filter workspace:cleared events by workspace subscription', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss);
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(1));

      mockWsEmit(c1.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-sub' })));

      // Cleared for ws-sub should arrive
      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-sub' });
      const matchCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'workspace:cleared'
      );
      expect(matchCalls).toHaveLength(1);

      // Cleared for ws-other should NOT arrive
      registryStateRef.emitter.emit('workspace:cleared', { workspaceId: 'ws-other' });
      const remainCalls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'workspace:cleared'
      );
      expect(remainCalls).toHaveLength(1); // still just the first one
    });

    it('should allow one subscribed client and one unsubscribed client to coexist', async () => {
      const { broadcaster, wss } = createBroadcaster();

      const c1 = simulateConnection(broadcaster, wss); // no subscriptions
      const c2 = simulateConnection(broadcaster, wss); // will subscribe
      await vi.waitFor(() => expect(broadcaster.getConnectedClients()).toBe(2));

      mockWsEmit(c2.ws, 'message', Buffer.from(JSON.stringify({ type: 'subscribe', workspaceId: 'ws-a' })));

      // Emit for ws-a: c1 gets it (no filter), c2 gets it (matches subscription)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-a', id: 'p-a' }));

      const c1Calls = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      const c2Calls = (c2.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(c1Calls).toHaveLength(1);
      expect(c2Calls).toHaveLength(1);

      // Emit for ws-b: c1 gets it (no filter), c2 does NOT (not in ws-b)
      registryStateRef.emitter.emit('preview:registered', makePreview({ workspaceId: 'ws-b', id: 'p-b' }));

      const c1Calls2 = (c1.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      const c2Calls2 = (c2.rawWs.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any) => JSON.parse(call[0]).type === 'preview:registered'
      );
      expect(c1Calls2).toHaveLength(2); // c1 got both
      expect(c2Calls2).toHaveLength(1); // c2 only got ws-a
    });
  });
});
