/**
 * Cross-process VFS snapshot broadcaster (Redis pub/sub)
 *
 * Bug #16 (audit) — follow-up to the original read-after-write fix.
 *
 * The original Bug #16 fix (`getCurrentVersionSync` + listener-tracked
 * `latestSeenVersion`) was strictly single-process. In a multi-worker
 * Next.js deployment, worker A's write updates its in-memory `workspaces`
 * Map and fires its local `onSnapshotChange` listener, but worker B's
 * in-memory Map is still empty and worker B never sees the local
 * listener fire. A read on worker B will see `currentVersion = 0` from
 * its own Map and fall back to the (also empty) `listenerVersion` —
 * serving stale data.
 *
 * This module closes the gap using Redis pub/sub:
 *
 *   worker A (writer)             Redis channel             worker B (reader)
 *   ─────────────────             ─────────────             ─────────────────
 *   writeFile(...)
 *     → workspaces.set(...)       PUBLISH                   on('message', ...)
 *     → emitSnapshotChange()      'vfs:snapshot:changed'    → listeners.forEach(...)
 *       → broadcaster.publish()   {ownerId, version}        → latestSeenVersion
 *                                                            → snapshotCache.delete(...)
 *
 * The local in-process `onSnapshotChange` listener still fires first
 * (and remains the source of truth within a process). The Redis
 * broadcast is best-effort — if Redis is unavailable, the single-process
 * path still works; only cross-process invalidation degrades.
 *
 * Design notes:
 * - Publisher uses the shared `getRedisClient()` (publishing is just a
 *   normal command). Subscribers MUST use a dedicated connection (Redis
 *   blocks subscribers on the protocol level once they enter
 *   subscribe-mode), so `getSnapshotBroadcaster()` lazily creates a
 *   separate `Redis` instance for subscribing.
 * - `publish()` is fire-and-forget: failures are logged and swallowed.
 *   The write must not be blocked on a Redis hiccup.
 * - `subscribe()` is idempotent — re-registering the same listener has
 *   no extra effect.
 * - One channel for the whole app: `vfs:snapshot:changed`. Per-owner
 *   routing is done in the message handler.
 * - The broadcaster caches the returned API object on `globalThis` so
 *   `getSnapshotBroadcaster() === getSnapshotBroadcaster()` is true
 *   across hot-reloads (consumers can rely on referential equality).
 *
 * Environment:
 * - `REDIS_URL` must be set to enable pub/sub. If unset, the broadcaster
 *   is a no-op (publish() silently does nothing, subscribe() is a no-op).
 *   This matches the `getRedisClient()` fallback to `redis://localhost:6379`.
 */

import Redis from 'ioredis';
import { getRedisClient } from '@/lib/redis/client';
import { createLogger } from '@/lib/utils/logger';
// Pass-2 cross-cutting theme: record EPIPE / publish failures into the
// per-session degradation chain so run.log shows the broadcaster failure
// that contributed to the user reprompting.
import { recordDegradation } from '@/lib/observability/degradation-tracker';

const logger = createLogger('VFS:Snapshot:Broadcaster');

/** Channel name. Keep in sync with the SUBSCRIBE side. */
export const SNAPSHOT_CHANGED_CHANNEL = 'vfs:snapshot:changed';

/** Wire format for cross-process snapshot invalidation messages. */
export interface SnapshotChangedMessage {
  /** VFS ownerId. */
  ownerId: string;
  /** Workspace version after the write. */
  version: number;
  /** Producer id (helps debug whether a notification is local or remote). */
  source: string;
  /** ISO-8601 timestamp of when the message was published. */
  ts: string;
}

/** Per-process producer id, so a subscriber can tell self-emitted messages apart. */
const PRODUCER_ID = `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

/** Snapshot-change listener callback. */
export type SnapshotChangedListener = (msg: SnapshotChangedMessage) => void;

interface BroadcasterState {
  /** Dedicated subscriber connection. Null until the first subscribe(). */
  subscriber: Redis | null;
  /** Registered listeners (process-local). */
  listeners: Set<SnapshotChangedListener>;
  /** True once we've called .subscribe() on the subscriber connection. */
  subscribed: boolean;
  /** Last time we logged a "Redis unavailable" warning (ms epoch). 0 = never. */
  lastWarnedAt: number;
  /** Cached API object so getSnapshotBroadcaster() is referentially stable. */
  api?: SnapshotBroadcasterApi;
}

export type SnapshotBroadcasterApi = {
  /** Fire-and-forget publish. Returns immediately; errors are logged. */
  publish: (ownerId: string, version: number) => void;
  /** Register a listener. Returns an unsubscribe function. */
  subscribe: (listener: SnapshotChangedListener) => () => void;
  /** Test-only: tear down the subscriber connection. */
  _reset: () => Promise<void>;
  /** Test-only: was the broadcaster able to subscribe to Redis? */
  isRedisBacked: () => boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __vfsSnapshotBroadcaster__: BroadcasterState | undefined;
}

/**
 * How long to suppress repeat "Redis unavailable" warnings. Operators
 * need periodic visibility into recent failures (e.g. when debugging
 * "why isn't worker B seeing worker A's writes") but log spam is
 * unhelpful when Redis is down for an extended period.
 */
const WARN_COOLDOWN_MS = 30_000;

/**
 * Returns the process-wide snapshot broadcaster singleton.
 * The state and the returned API object both live on `globalThis`
 * so they survive Next.js hot-reloads. The function is referentially
 * stable — `getSnapshotBroadcaster() === getSnapshotBroadcaster()`.
 */
export function getSnapshotBroadcaster(): SnapshotBroadcasterApi {
  if (!globalThis.__vfsSnapshotBroadcaster__) {
    globalThis.__vfsSnapshotBroadcaster__ = {
      subscriber: null,
      listeners: new Set(),
      subscribed: false,
      lastWarnedAt: 0,
    };
  }
  const state = globalThis.__vfsSnapshotBroadcaster__;

  if (state.api) {
    return state.api;
  }

  /**
   * Lazily create the dedicated subscriber connection and subscribe to
   * the channel. Idempotent — only runs once per process.
   */
  function ensureSubscribed(): boolean {
    if (state.subscribed) return true;
    if (state.subscriber) return true; // in-flight init

    let sub: Redis;
    try {
      // Re-use the same REDIS_URL + retry strategy as the shared client.
      const url = process.env.REDIS_URL || 'redis://localhost:6379';
      sub = new Redis(url, {
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Snapshot broadcaster retry limit reached');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        // Disable auto-reconnect spam on shutdown
        maxRetriesPerRequest: 1,
      });

      sub.on('error', (err) => {
        const now = Date.now();
        if (now - state.lastWarnedAt > WARN_COOLDOWN_MS) {
          logger.warn('[VFS Snapshot Broadcaster] Subscriber connection error:', err.message);
          state.lastWarnedAt = now;
        }
        // Pass-2 cross-cutting theme: record the EPIPE / connection error.
        // sessionId is 'default' because the broadcaster is process-wide and
        // not per-request. Operators can still correlate by timestamp.
        try {
          recordDegradation(
            'default',
            'broadcaster_epipe',
            'snapshot-broadcaster',
            { error: err.message, kind: 'subscriber_error' },
          );
        } catch { /* best-effort */ }
      });

      sub.on('connect', () => {
        logger.info('[VFS Snapshot Broadcaster] Subscriber connected');
        state.lastWarnedAt = 0;
      });
    } catch (err) {
      logger.warn(
        '[VFS Snapshot Broadcaster] Failed to create subscriber connection:',
        err instanceof Error ? err.message : String(err)
      );
      return false;
    }

    state.subscriber = sub;

    sub.subscribe(SNAPSHOT_CHANGED_CHANNEL)
      .then(() => {
        state.subscribed = true;
        logger.info(`[VFS Snapshot Broadcaster] Subscribed to ${SNAPSHOT_CHANGED_CHANNEL}`);
      })
      .catch((err) => {
        logger.warn(
          '[VFS Snapshot Broadcaster] SUBSCRIBE failed:',
          err instanceof Error ? err.message : String(err)
        );
        // Don't set subscribed — next publish will retry.
        state.subscriber = null;
      });

    sub.on('message', (channel, raw) => {
      if (channel !== SNAPSHOT_CHANGED_CHANNEL) return;
      let msg: SnapshotChangedMessage | null = null;
      try {
        msg = JSON.parse(raw) as SnapshotChangedMessage;
      } catch (err) {
        logger.warn('[VFS Snapshot Broadcaster] Failed to parse message:', err instanceof Error ? err.message : String(err));
        return;
      }
      if (!msg || typeof msg.ownerId !== 'string' || typeof msg.version !== 'number') {
        logger.warn('[VFS Snapshot Broadcaster] Malformed message:', raw);
        return;
      }
      for (const listener of state.listeners) {
        try {
          listener(msg);
        } catch (err) {
          logger.warn(
            '[VFS Snapshot Broadcaster] Listener threw:',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    });

    return true;
  }

  const api: SnapshotBroadcasterApi = {
    /**
     * Fire-and-forget publish. Never throws. If Redis is unavailable,
     * the local in-process listener (registered on `onSnapshotChange`)
     * still fires — Redis is purely a cross-process signal.
     */
    publish(ownerId: string, version: number): void {
      if (typeof ownerId !== 'string' || typeof version !== 'number') {
        return;
      }
      const message: SnapshotChangedMessage = {
        ownerId,
        version,
        source: PRODUCER_ID,
        ts: new Date().toISOString(),
      };
      let publisher: Redis;
      try {
        publisher = getRedisClient();
      } catch (err) {
        // getRedisClient() shouldn't throw, but be defensive.
        return;
      }
      publisher
        .publish(SNAPSHOT_CHANGED_CHANNEL, JSON.stringify(message))
        .catch((err) => {
          // Swallow — Redis is best-effort. Single-process invalidation
          // is still intact via the local onSnapshotChange listener.
          // Use the same cooldown as the subscriber so operators get
          // periodic visibility without log spam.
          const now = Date.now();
          if (now - state.lastWarnedAt > WARN_COOLDOWN_MS) {
            logger.warn(
              '[VFS Snapshot Broadcaster] PUBLISH failed:',
              err instanceof Error ? err.message : String(err)
            );
            state.lastWarnedAt = now;
          }
          // Pass-2 cross-cutting theme: record the publish failure. Note
          // ownerId is per-write, so we attribute to that session.
          try {
            recordDegradation(
              message.ownerId,
              'broadcaster_epipe',
              'snapshot-broadcaster',
              { error: err.message, kind: 'publish_failure' },
            );
          } catch { /* best-effort */ }
        });
    },

    /**
     * Register a listener for incoming pub/sub messages. Returns an
     * unsubscribe function. Safe to call before Redis is reachable —
     * listeners will be invoked as soon as the subscription completes.
     */
    subscribe(listener: SnapshotChangedListener): () => void {
      state.listeners.add(listener);
      ensureSubscribed();
      return () => {
        state.listeners.delete(listener);
      };
    },

    /** Test-only: tear down the subscriber. */
    async _reset(): Promise<void> {
      state.listeners.clear();
      if (state.subscriber) {
        try {
          await state.subscriber.unsubscribe(SNAPSHOT_CHANGED_CHANNEL);
        } catch {
          // best-effort
        }
        try {
          state.subscriber.disconnect();
        } catch {
          // best-effort
        }
      }
      state.subscriber = null;
      state.subscribed = false;
      state.lastWarnedAt = 0;
      // Drop the cached API so a fresh one is built on the next call
      // (helpful for tests; in production this is a no-op after first init).
      delete state.api;
    },

    /** Test-only: was the broadcaster able to subscribe to Redis? */
    isRedisBacked(): boolean {
      return state.subscribed;
    },
  };

  state.api = api;
  return api;
}
