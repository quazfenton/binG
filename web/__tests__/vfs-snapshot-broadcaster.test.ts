/**
 * Cross-process VFS snapshot broadcaster tests
 *
 * Bug #16 (audit) follow-up — the multi-worker caveat in the read-after-write
 * fix. Worker A's `emitSnapshotChange` must reach worker B's `latestSeenVersion`
 * so worker B can invalidate its own cache entries.
 *
 * We use a `vi.hoisted` FakeRedis class so the ioredis mock and the
 * @/lib/redis/client mock both reference the SAME class instance
 * (vi.mock factories can't share state via top-level imports because
 * vi.mock is hoisted ABOVE all imports; `require('ioredis')` inside the
 * second mock resolves to the real package, not the mocked one).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.hoisted` runs BEFORE the vi.mock factories, so both mocks can
// reference the same FakeRedis class without `require()` hacks that
// bypass the mock.
const { FakeRedis } = vi.hoisted(() => {
  type Handler = (channel: string, message: string) => void;
  class FakeRedis {
    static instances: FakeRedis[] = [];
    private messageHandlers: Set<Handler> = new Set();
    private subscribedChannels: Set<string> = new Set();
    status: 'wait' | 'connecting' | 'connect' | 'ready' = 'ready';

    constructor(_url: string) {
      FakeRedis.instances.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): this {
      if (event === 'message' && typeof handler === 'function') {
        this.messageHandlers.add(handler as Handler);
      }
      return this;
    }

    off(event: string, handler: (...args: any[]) => void): this {
      if (event === 'message') {
        this.messageHandlers.delete(handler as Handler);
      }
      return this;
    }

    async subscribe(channel: string): Promise<number> {
      this.subscribedChannels.add(channel);
      return this.subscribedChannels.size;
    }

    async unsubscribe(channel: string): Promise<number> {
      this.subscribedChannels.delete(channel);
      return this.subscribedChannels.size;
    }

    async publish(channel: string, message: string): Promise<number> {
      // Cross-instance delivery: a publish on the "writer" instance
      // must reach subscribers on every other instance. We iterate
      // ALL instances and invoke their registered message handlers if
      // they are subscribed to this channel.
      let delivered = 0;
      for (const inst of FakeRedis.instances) {
        if (!inst.subscribedChannels.has(channel)) continue;
        for (const h of inst.messageHandlers) {
          h(channel, message);
          delivered++;
        }
      }
      return delivered;
    }

    async ping(): Promise<string> {
      return 'PONG';
    }

    disconnect(): void {
      this.messageHandlers.clear();
      this.subscribedChannels.clear();
    }

    async quit(): Promise<'OK'> {
      this.disconnect();
      return 'OK';
    }
  }
  return { FakeRedis };
});

vi.mock('ioredis', () => ({
  default: FakeRedis,
  Redis: FakeRedis,
}));

// The shared @/lib/redis/client mock uses the SAME FakeRedis class
// (no require() hack — vi.hoisted guarantees the class is defined
// before this factory runs).
vi.mock('@/lib/redis/client', () => ({
  getRedisClient: () => new FakeRedis('redis://test-broadcaster-publisher'),
  closeRedisClient: async () => 'OK',
}));

import { getSnapshotBroadcaster, SNAPSHOT_CHANGED_CHANNEL } from '@/lib/virtual-filesystem/snapshot-broadcaster';

describe('VFS Snapshot Broadcaster (Bug #16 multi-worker)', () => {
  beforeEach(async () => {
    await getSnapshotBroadcaster()._reset();
    FakeRedis.instances.length = 0;
  });

  afterEach(async () => {
    await getSnapshotBroadcaster()._reset();
    FakeRedis.instances.length = 0;
  });

  it('exports a stable channel name', () => {
    expect(SNAPSHOT_CHANGED_CHANNEL).toBe('vfs:snapshot:changed');
  });

  it('returns the same singleton across calls', () => {
    const a = getSnapshotBroadcaster();
    const b = getSnapshotBroadcaster();
    expect(a).toBe(b);
  });

  it('publish() is fire-and-forget and never throws', () => {
    const broadcaster = getSnapshotBroadcaster();
    expect(() => broadcaster.publish('owner-x', 1)).not.toThrow();
    expect(() => broadcaster.publish('owner-y', 9999)).not.toThrow();
  });

  it('publish() ignores non-string ownerId or non-number version', () => {
    const broadcaster = getSnapshotBroadcaster();
    // @ts-expect-error: testing runtime defensive behavior
    expect(() => broadcaster.publish(undefined, 1)).not.toThrow();
    // @ts-expect-error
    expect(() => broadcaster.publish('owner', 'not-a-number')).not.toThrow();
    // @ts-expect-error
    expect(() => broadcaster.publish(null, null)).not.toThrow();
  });

  it('subscribe() returns an unsubscribe function that detaches the listener', async () => {
    const broadcaster = getSnapshotBroadcaster();
    const received: Array<{ ownerId: string; version: number }> = [];
    const unsub = broadcaster.subscribe((msg) => {
      received.push({ ownerId: msg.ownerId, version: msg.version });
    });

    await new Promise((r) => setTimeout(r, 20));
    broadcaster.publish('owner-a', 5);
    await new Promise((r) => setTimeout(r, 50));

    // The subscriber MUST receive its own published message (the mock
    // delivers to all subscribers including the publisher's own
    // instance). The listener was attached; verify it fires.
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].ownerId).toBe('owner-a');

    const beforeUnsub = received.length;
    unsub();
    broadcaster.publish('owner-b', 7);
    await new Promise((r) => setTimeout(r, 50));
    // After unsubscribe, no new messages
    expect(received.length).toBe(beforeUnsub);
  });

  it('multiple subscribers all receive the same published message', async () => {
    const broadcaster = getSnapshotBroadcaster();
    const a: string[] = [];
    const b: string[] = [];
    const unsubA = broadcaster.subscribe((msg) => a.push(msg.ownerId));
    const unsubB = broadcaster.subscribe((msg) => b.push(msg.ownerId));

    await new Promise((r) => setTimeout(r, 20));
    broadcaster.publish('owner-shared', 42);
    await new Promise((r) => setTimeout(r, 50));

    expect(a).toContain('owner-shared');
    expect(b).toContain('owner-shared');

    unsubA();
    unsubB();
  });

  it('listener exceptions do not stop other listeners from receiving the message', async () => {
    const broadcaster = getSnapshotBroadcaster();
    const received: string[] = [];
    const unsubBad = broadcaster.subscribe(() => {
      throw new Error('boom');
    });
    const unsubGood = broadcaster.subscribe((msg) => {
      received.push(msg.ownerId);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(() => broadcaster.publish('owner-x', 1)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain('owner-x');

    unsubBad();
    unsubGood();
  });

  it('_reset() drops all listeners and disconnects the subscriber', async () => {
    const broadcaster = getSnapshotBroadcaster();
    const received: string[] = [];
    broadcaster.subscribe((msg) => received.push(msg.ownerId));

    await new Promise((r) => setTimeout(r, 20));
    await broadcaster._reset();
    FakeRedis.instances.length = 0;

    // After reset, the listener is gone. Publish and verify nothing
    // is received (no live subscriber exists, so delivery is a no-op).
    broadcaster.publish('owner-after-reset', 99);
    await new Promise((r) => setTimeout(r, 50));
    expect(received).not.toContain('owner-after-reset');
  });

  it('message includes ownerId, version, source, and ts', async () => {
    const broadcaster = getSnapshotBroadcaster();
    let captured: any = null;
    const unsub = broadcaster.subscribe((msg) => {
      captured = msg;
    });

    await new Promise((r) => setTimeout(r, 20));
    broadcaster.publish('owner-meta', 123);
    await new Promise((r) => setTimeout(r, 50));

    expect(captured).not.toBeNull();
    expect(captured.ownerId).toBe('owner-meta');
    expect(captured.version).toBe(123);
    expect(typeof captured.source).toBe('string');
    expect(captured.source.length).toBeGreaterThan(0);
    expect(typeof captured.ts).toBe('string');
    expect(new Date(captured.ts).toString()).not.toBe('Invalid Date');

    unsub();
  });

  it('source field is a worker-prefixed string', async () => {
    const broadcaster = getSnapshotBroadcaster();
    let captured: any = null;
    const unsub = broadcaster.subscribe((msg) => {
      captured = msg;
    });
    await new Promise((r) => setTimeout(r, 20));
    broadcaster.publish('owner-src', 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(captured).not.toBeNull();
    expect(typeof captured.source).toBe('string');
    expect(captured.source).toMatch(/^worker-/);
    unsub();
  });
});
