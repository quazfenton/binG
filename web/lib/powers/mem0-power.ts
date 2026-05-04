/**
 * Mem0 Persistent Memory Power
 * 
 * Provides persistent memory capabilities using the Mem0 Platform API.
 * Enables the agent to remember user preferences, conversation context,
 * and retrieve relevant memories across sessions.
 * 
 * Actions:
 * - add: Store memories from a conversation
 * - search: Retrieve relevant memories for a query
 * - get_all: Get all memories for a user
 * - update: Update an existing memory
 * - delete: Delete a specific memory
 * - delete_all: Delete all memories for a user
 */

import { z } from 'zod';
import { createLogger } from '@/lib/utils/logger';

const log = createLogger('Powers:Mem0');

// ============================================================================
// Types
// ============================================================================

export interface Mem0Config {
  apiKey?: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
}

// Memory entry from Mem0
export interface Mem0Memory {
  id: string;
  memory: string;
  score?: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================================================
// Mem0 Client (simplified wrapper around mem0ai)
// ============================================================================

// Default timeouts (override via Mem0Config or per-call where applicable)
const DEFAULT_SEARCH_TIMEOUT_MS = 2_500;
const DEFAULT_ADD_TIMEOUT_MS = 8_000;
const DEFAULT_DEFAULT_TIMEOUT_MS = 5_000;
const ADD_MAX_RETRIES = 1; // 1 retry on transient errors (total: 2 attempts)

/**
 * fetch with AbortController-driven timeout. Throws an Error("timeout") on
 * deadline; rethrows underlying fetch errors otherwise.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Mem0 request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Decide whether an HTTP status is worth retrying. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/** Sleep helper for retry backoff. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter (ms): 250, 750, 1750, … */
function backoffMs(attempt: number): number {
  const base = 250 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 100);
  return base + jitter;
}

class Mem0Client {
  private apiKey: string;
  private baseUrl = 'https://api.mem0.ai';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Add memories from conversation messages.
   * Retries on transient errors (429/5xx/network) with exponential backoff.
   */
  async add(
    messages: Array<{ role: string; content: string; name?: string }>,
    options: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      infer?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<{ results?: Mem0Memory[]; message?: string }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_ADD_TIMEOUT_MS;
    const body = JSON.stringify({
      messages,
      user_id: options.userId,
      agent_id: options.agentId,
      run_id: options.sessionId,
      metadata: options.metadata,
      ...(options.infer === false ? { infer: false } : {}),
    });

    let lastErr: any;
    for (let attempt = 0; attempt <= ADD_MAX_RETRIES; attempt++) {
      try {
        const response = await fetchWithTimeout(
          `${this.baseUrl}/v1/memories/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Token ${this.apiKey}`,
            },
            body,
          },
          timeoutMs,
        );

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const message = errBody.detail || `Failed to add memories (HTTP ${response.status})`;
          if (isRetryableStatus(response.status) && attempt < ADD_MAX_RETRIES) {
            lastErr = new Error(message);
            await sleep(backoffMs(attempt));
            continue;
          }
          throw new Error(message);
        }

        return await response.json();
      } catch (err: any) {
        lastErr = err;
        // Retry on network/timeout errors, but only within retry budget
        if (attempt < ADD_MAX_RETRIES) {
          await sleep(backoffMs(attempt));
          continue;
        }
        log.error('Mem0 add failed', { error: err.message, attempts: attempt + 1 });
        throw err;
      }
    }
    // Defensive — loop always returns or throws above
    throw lastErr ?? new Error('Mem0 add failed');
  }

  /**
   * Search memories for a query.
   * Hot path — no retries (caller wraps in fire-and-forget). Uses advanced
   * retrieval flags (keyword_search + rerank + threshold) for higher quality.
   */
  async search(
    query: string,
    options: {
      userId?: string;
      agentId?: string;
      sessionId?: string;
      limit?: number;
      filters?: Record<string, any>;
      keywordSearch?: boolean;
      rerank?: boolean;
      filterMemories?: boolean;
      threshold?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<{ results?: Mem0Memory[] }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS;
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/memories/search/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${this.apiKey}`,
          },
          body: JSON.stringify({
            query,
            user_id: options.userId,
            agent_id: options.agentId,
            run_id: options.sessionId,
            limit: options.limit || 10,
            filters: options.filters,
            // Advanced retrieval — defaults tuned for balanced precision/latency
            keyword_search: options.keywordSearch ?? true,
            rerank: options.rerank ?? true,
            ...(options.filterMemories ? { filter_memories: true } : {}),
            ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
          }),
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to search memories (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 search failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Get all memories for a user/agent
   */
  async getAll(
    options: { userId?: string; agentId?: string; limit?: number; timeoutMs?: number } = {}
  ): Promise<{ results?: Mem0Memory[] }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEFAULT_TIMEOUT_MS;
    try {
      const params = new URLSearchParams();
      if (options.userId) params.append('user_id', options.userId);
      if (options.agentId) params.append('agent_id', options.agentId);
      if (options.limit) params.append('limit', String(options.limit));

      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/memories/?${params}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
          },
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to get memories (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 get_all failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Update a memory
   */
  async update(memoryId: string, text: string, timeoutMs = DEFAULT_DEFAULT_TIMEOUT_MS): Promise<{ message?: string }> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/memories/${memoryId}/`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Token ${this.apiKey}`,
          },
          body: JSON.stringify({ memory: text }),
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to update memory (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 update failed', { error: err.message, memoryId });
      throw err;
    }
  }

  /**
   * Delete a memory
   */
  async delete(memoryId: string, timeoutMs = DEFAULT_DEFAULT_TIMEOUT_MS): Promise<{ message?: string }> {
    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/memories/${memoryId}/`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
          },
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to delete memory (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 delete failed', { error: err.message, memoryId });
      throw err;
    }
  }

  /**
   * Delete all memories for a user/agent
   */
  async deleteAll(options: { userId?: string; agentId?: string; timeoutMs?: number } = {}): Promise<{ message?: string }> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_DEFAULT_TIMEOUT_MS;
    try {
      const params = new URLSearchParams();
      if (options.userId) params.append('user_id', options.userId);
      if (options.agentId) params.append('agent_id', options.agentId);

      const response = await fetchWithTimeout(
        `${this.baseUrl}/v1/memories/?${params}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Token ${this.apiKey}`,
          },
        },
        timeoutMs,
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.detail || `Failed to delete memories (HTTP ${response.status})`);
      }

      return await response.json();
    } catch (err: any) {
      log.error('Mem0 delete_all failed', { error: err.message });
      throw err;
    }
  }
}

// ============================================================================
// Client instance management
// ============================================================================

let mem0Client: Mem0Client | null = null;

// ─── Circuit breaker ────────────────────────────────────────────────────────
// On sustained Mem0 outages, every chat request would otherwise eat the 2.5 s
// search timeout. Trip the breaker after N transient failures within a window;
// while open, `isMem0Configured()` returns false so callers skip Mem0 entirely
// (no fetch, no timeout, ~0 ms cost). After the cooldown elapses, the next
// request is allowed through (HALF_OPEN probe). A success closes the breaker;
// another failure re-opens it for another cooldown.
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_FAIL_WINDOW_MS = 60_000;
const CIRCUIT_COOLDOWN_MS = 5 * 60_000; // 5 minutes
const _circuitFailures: number[] = [];
let _circuitOpenUntil = 0;
let _circuitProbeInFlight = false;

/** Returns true while the breaker is OPEN (skip Mem0 calls entirely). */
function isCircuitOpen(): boolean {
  if (_circuitOpenUntil === 0) return false;
  if (Date.now() < _circuitOpenUntil) return true;
  // Cooldown elapsed — allow exactly one probe to pass through (HALF_OPEN).
  // Subsequent calls during the same probe still see OPEN to avoid stampedes.
  if (!_circuitProbeInFlight) {
    _circuitProbeInFlight = true;
    return false;
  }
  return true;
}

/** Record a transient/network/timeout failure. Trips the breaker if threshold met. */
function recordMem0Failure(reason: string): void {
  const now = Date.now();
  // Drop failures outside the rolling window
  while (_circuitFailures.length > 0 && now - _circuitFailures[0] > CIRCUIT_FAIL_WINDOW_MS) {
    _circuitFailures.shift();
  }
  _circuitFailures.push(now);
  if (_circuitFailures.length >= CIRCUIT_FAIL_THRESHOLD) {
    _circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
    _circuitFailures.splice(0, _circuitFailures.length);
    _circuitProbeInFlight = false;
    log.warn('Mem0 circuit breaker BLOCKED', {
      reason,
      cooldownMs: CIRCUIT_COOLDOWN_MS,
      reopensAt: new Date(_circuitOpenUntil).toISOString(),
    });
  }
  // If a probe failed during HALF_OPEN, immediately re-open the circuit.
  if (_circuitProbeInFlight) {
    _circuitProbeInFlight = false;
    _circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
    log.warn('Mem0 probe failed — circuit re-BLOCKED', {
      reason,
      reopensAt: new Date(_circuitOpenUntil).toISOString(),
    });
  }
}

/** Record a successful call. Resets the breaker. */
function recordMem0Success(): void {
  if (_circuitFailures.length > 0) _circuitFailures.splice(0, _circuitFailures.length);
  if (_circuitOpenUntil !== 0 || _circuitProbeInFlight) {
    log.info('Mem0 circuit breaker HEALTHY');
  }
  _circuitOpenUntil = 0;
  _circuitProbeInFlight = false;
}

/** Inspect circuit state (for diagnostics / health endpoints). */
export function getMem0CircuitState(): {
  state: 'HEALTHY' | 'BLOCKED' | 'TESTING';
  recentFailures: number;
  reopensAt: string | null;
} {
  const now = Date.now();
  if (_circuitOpenUntil > now) {
    return {
      state: 'BLOCKED',
      recentFailures: _circuitFailures.length,
      reopensAt: new Date(_circuitOpenUntil).toISOString(),
    };
  }
  if (_circuitOpenUntil !== 0 && _circuitProbeInFlight) {
    return { state: 'TESTING', recentFailures: _circuitFailures.length, reopensAt: null };
  }
  return { state: 'HEALTHY', recentFailures: _circuitFailures.length, reopensAt: null };
}

/** Test/diagnostic helper — force-close the breaker. */
export function resetMem0CircuitBreaker(): void {
  _circuitFailures.splice(0, _circuitFailures.length);
  _circuitOpenUntil = 0;
  _circuitProbeInFlight = false;
}

/**
 * Decide whether an error should count as a circuit failure.
 * Bad-input/4xx errors are caller bugs and shouldn't trip the breaker —
 * only transport-level problems (timeout/5xx/network) should.
 */
function isCircuitTrippingError(err: any): boolean {
  const msg = String(err?.message || '');
  if (/timed out/i.test(msg)) return true;
  if (/HTTP 5\d{2}/i.test(msg)) return true;
  if (/HTTP 408|HTTP 425|HTTP 429/i.test(msg)) return true;
  // Bare network errors (no HTTP status) — fetch failures, DNS, etc.
  if (!/HTTP \d{3}/i.test(msg)) return true;
  return false;
}

/**
 * Check if mem0 is configured with API key.
 * Returns false if the circuit breaker is OPEN — so all callers automatically
 * skip Mem0 during sustained outages with zero added latency.
 */
export function isMem0Configured(): boolean {
  if (!process.env.MEM0_API_KEY || process.env.MEM0_API_KEY.length === 0) {
    return false;
  }
  if (isCircuitOpen()) {
    return false;
  }
  return true;
}

/**
 * Initialize or get the Mem0 client
 */
export function getMem0Client(apiKey?: string): Mem0Client {
  const key = apiKey || process.env.MEM0_API_KEY;
  if (!key) {
    throw new Error('MEM0_API_KEY not configured. Please set MEM0_API_KEY environment variable.');
  }
  
  if (!mem0Client) {
    mem0Client = new Mem0Client(key);
  }
  return mem0Client;
}

/**
 * Reset the client (for testing or reconfiguration)
 */
export function resetMem0Client(): void {
  mem0Client = null;
}

// ============================================================================
// Power Actions
// ============================================================================

/**
 * Action: Add memories from conversation
 */
export async function mem0Add(
  args: {
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; name?: string }>;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    metadata?: Record<string, any>;
    /** Set false to skip Mem0 LLM extraction (fast path for explicit user notes) */
    infer?: boolean;
    timeoutMs?: number;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    const effectiveUserId = args.userId || config.userId;
    const result = await client.add(args.messages, {
      userId: effectiveUserId,
      agentId: args.agentId || config.agentId,
      sessionId: args.sessionId || config.sessionId,
      metadata: args.metadata,
      infer: args.infer,
      timeoutMs: args.timeoutMs,
    });
    log.info('Mem0 memories added', { count: result.results?.length || 0 });
    recordMem0Success();
    // Invalidate search cache for this user — new memories may change results.
    // (Mem0 add is asynchronous server-side, but cache reflects the user's
    // intent so dropping stale results is the right call.)
    if (effectiveUserId) {
      invalidateMem0SearchCacheForUser(effectiveUserId);
    } else {
      // Fallback: clear entire search cache if userId is absent
      clearMem0SearchCache();
    }
    return { success: true, results: result.results };
  } catch (err: any) {
    log.error('mem0_add failed', { error: err.message });
    if (isCircuitTrippingError(err)) {
      recordMem0Failure(`add: ${err.message}`);
    }
    return { success: false, error: err.message };
  }
}

/** Drop all cached search entries for a user. Called after successful adds. */
function invalidateMem0SearchCacheForUser(userId: string): void {
  // Cache key starts with `${userId}|...` — see makeMem0SearchCacheKey.
  const prefix = `${userId}|`;
  for (const key of _mem0SearchCache.keys()) {
    if (key.startsWith(prefix)) {
      _mem0SearchCache.delete(key);
    }
  }
}

// ─── Pre-warm helper ────────────────────────────────────────────────────────
// Fires a fire-and-forget broad mem0 search to populate the in-memory cache
// before the user's first hot-path request needs memory. The actual chat
// request still issues its own targeted query (different cache key), but this
// hides the TLS handshake / cold connection latency behind whatever else is
// loading at session boot.

const PREWARM_DEDUP_WINDOW_MS = 2 * 60_000; // don't prewarm same user > once per 2 min
const _mem0PrewarmedAt = new Map<string, number>();

/**
 * Warm the mem0 search cache for a user with a broad memory query.
 *
 * Returns immediately (does not await the network call). Idempotent within
 * a 2-minute window per user — repeated calls are no-ops.
 *
 * Wire this up at session/thread boot (e.g., when the chat UI mounts, or on
 * the first user message of a new conversation).
 *
 * @param userId The user whose memories to pre-fetch.
 * @param opts.query Optional broad query (default: profile/preference style).
 * @param opts.limit Max memories to retrieve (default 10).
 */
export function prewarmMem0Cache(
  userId: string,
  opts: { query?: string; limit?: number; agentId?: string } = {},
): void {
  if (!userId) return;
  if (!isMem0Configured()) return; // also short-circuits when circuit is OPEN

  const now = Date.now();
  const lastAt = _mem0PrewarmedAt.get(userId) ?? 0;
  if (now - lastAt < PREWARM_DEDUP_WINDOW_MS) {
    return;
  }
  _mem0PrewarmedAt.set(userId, now);

  // LRU cap — drop oldest dedup entries to bound memory
  if (_mem0PrewarmedAt.size > 1024) {
    const it = _mem0PrewarmedAt.keys();
    for (let i = 0; i < 128; i++) {
      const next = it.next();
      if (next.done) break;
      _mem0PrewarmedAt.delete(next.value);
    }
  }

  // Default broad query — designed to surface durable user-level memories
  // (preferences, conventions, project facts) that are useful regardless of
  // the specific next prompt. The search result populates the LRU cache, so
  // a follow-up `mem0Search` from the chat route with the same shape hits
  // the cache (~0 ms) instead of the network.
  const query =
    opts.query ??
    'user preferences, conventions, project context, past decisions';

  // Fire-and-forget. Errors are logged at debug — never propagate.
  mem0Search({
    query,
    userId,
    agentId: opts.agentId,
    limit: opts.limit ?? 10,
    threshold: 0.3,
  }).then(
    (res) => {
      if (res.success) {
        log.debug('Mem0 cache pre-warmed', {
          userId,
          memoryCount: res.results?.length ?? 0,
        });
      }
    },
    () => {
      // Already logged inside mem0Search
    },
  );
}

/**
 * Test/diagnostic helper — clear pre-warm dedup state so subsequent
 * `prewarmMem0Cache` calls fire the network request again.
 */
export function resetMem0PrewarmState(): void {
  _mem0PrewarmedAt.clear();
}

/**
 * Action: Search memories
 */
// ─── Search-result cache ────────────────────────────────────────────────────
// Identical chat retries/double-clicks/auto-resends within ~30s shouldn't hit
// the Mem0 API again. Tiny in-memory TTL cache keyed by all parameters that
// affect the result. Bypass with `noCache: true` (e.g., immediately after a
// write that should change retrieval).
const MEM0_SEARCH_CACHE_TTL_MS = 30_000;
const MEM0_SEARCH_CACHE_MAX = 256;
type Mem0SearchCacheEntry = {
  expiresAt: number;
  result: { success: boolean; results?: Mem0Memory[]; error?: string };
};
const _mem0SearchCache = new Map<string, Mem0SearchCacheEntry>();

function makeMem0SearchCacheKey(args: {
  query: string;
  userId?: string;
  agentId?: string;
  sessionId?: string;
  limit?: number;
  filters?: Record<string, any>;
  keywordSearch?: boolean;
  rerank?: boolean;
  filterMemories?: boolean;
  threshold?: number;
}): string {
  // Truncate query to keep keys bounded; identical-prefix queries collide
  // intentionally to maximize cache hits on near-duplicate prompts.
  const q = (args.query || '').slice(0, 500);
  const filters = args.filters ? JSON.stringify(args.filters) : '';
  return [
    args.userId ?? '',
    args.agentId ?? '',
    args.sessionId ?? '',
    args.limit ?? '',
    args.threshold ?? '',
    args.keywordSearch === false ? '0' : '1',
    args.rerank === false ? '0' : '1',
    args.filterMemories ? '1' : '0',
    filters,
    q,
  ].join('|');
}

/** Test/diagnostic helper — clear the in-memory mem0 search cache. */
export function clearMem0SearchCache(): void {
  _mem0SearchCache.clear();
}

export async function mem0Search(
  args: {
    query: string;
    userId?: string;
    agentId?: string;
    sessionId?: string;
    limit?: number;
    filters?: Record<string, any>;
    /** Expand results with keyword matches (default: true) */
    keywordSearch?: boolean;
    /** Deep semantic reordering (default: true) */
    rerank?: boolean;
    /** Drop low-relevance results entirely (default: false; +200ms) */
    filterMemories?: boolean;
    /** Drop results below this score (e.g., 0.3) */
    threshold?: number;
    timeoutMs?: number;
    /** Skip the in-memory cache for this call */
    noCache?: boolean;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  // Cache lookup
  const cacheKey = makeMem0SearchCacheKey({
    query: args.query,
    userId: args.userId || config.userId,
    agentId: args.agentId || config.agentId,
    sessionId: args.sessionId || config.sessionId,
    limit: args.limit,
    filters: args.filters,
    keywordSearch: args.keywordSearch,
    rerank: args.rerank,
    filterMemories: args.filterMemories,
    threshold: args.threshold,
  });
  if (!args.noCache) {
    const cached = _mem0SearchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      log.debug('Mem0 search cache hit', { query: args.query.slice(0, 60) });
      return cached.result;
    }
    if (cached) {
      _mem0SearchCache.delete(cacheKey);
    }
  }

  try {
    const client = getMem0Client(config.apiKey);
    const result = await client.search(args.query, {
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
      sessionId: args.sessionId || config.sessionId,
      limit: args.limit,
      filters: args.filters,
      keywordSearch: args.keywordSearch,
      rerank: args.rerank,
      filterMemories: args.filterMemories,
      threshold: args.threshold,
      timeoutMs: args.timeoutMs,
    });
    log.info('Mem0 search completed', { query: args.query, count: result.results?.length || 0 });
    recordMem0Success();
    const out = { success: true, results: result.results };
    // Store in cache (only successful results — failures should retry)
    if (!args.noCache) {
      // Cheap LRU: when oversized, drop the oldest insertion
      if (_mem0SearchCache.size >= MEM0_SEARCH_CACHE_MAX) {
        const firstKey = _mem0SearchCache.keys().next().value;
        if (firstKey !== undefined) _mem0SearchCache.delete(firstKey);
      }
      _mem0SearchCache.set(cacheKey, {
        expiresAt: Date.now() + MEM0_SEARCH_CACHE_TTL_MS,
        result: out,
      });
    }
    return out;
  } catch (err: any) {
    log.error('mem0_search failed', { error: err.message });
    if (isCircuitTrippingError(err)) {
      recordMem0Failure(`search: ${err.message}`);
    }
    return { success: false, error: err.message };
  }
}

/**
 * Action: Get all memories
 */
export async function mem0GetAll(
  args: {
    userId?: string;
    agentId?: string;
    limit?: number;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; results?: Mem0Memory[]; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    const result = await client.getAll({
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
      limit: args.limit,
    });
    log.info('Mem0 get_all completed', { count: result.results?.length || 0 });
    return { success: true, results: result.results };
  } catch (err: any) {
    log.error('mem0_get_all failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Update a memory
 */
export async function mem0Update(
  args: {
    memoryId: string;
    text: string;
  },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.update(args.memoryId, args.text);
    log.info('Mem0 memory updated', { memoryId: args.memoryId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_update failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Delete a memory
 */
export async function mem0Delete(
  args: { memoryId: string },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.delete(args.memoryId);
    log.info('Mem0 memory deleted', { memoryId: args.memoryId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_delete failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Action: Delete all memories
 */
export async function mem0DeleteAll(
  args: { userId?: string; agentId?: string },
  config: Mem0Config = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getMem0Client(config.apiKey);
    await client.deleteAll({
      userId: args.userId || config.userId,
      agentId: args.agentId || config.agentId,
    });
    log.info('Mem0 all memories deleted', { userId: args.userId, agentId: args.agentId });
    return { success: true };
  } catch (err: any) {
    log.error('mem0_delete_all failed', { error: err.message });
    return { success: false, error: err.message };
  }
}

// ============================================================================
// Power Manifest
// ============================================================================

export const mem0PowerManifest = {
  id: 'mem0-memory',
  name: 'Mem0 Persistent Memory',
  version: '1.0.0',
  description: 'Add persistent memory to remember user preferences, conversation context, and retrieve relevant memories across sessions using Mem0 Platform.',
  triggers: ['remember', 'memory', 'persistent', 'preferences', 'context', 'user info', 'past conversations'],
  actions: [
    {
      name: 'add',
      description: 'Store memories from a conversation. Call after each user-agent interaction to build persistent context.',
      paramsSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          userId: { type: 'string', description: 'User identifier for scoping memories' },
          agentId: { type: 'string', description: 'Agent identifier (optional)' },
          sessionId: { type: 'string', description: 'Session/thread identifier (optional)' },
        },
        required: ['messages'],
      },
    },
    {
      name: 'search',
      description: 'Search memories for relevant context before responding. Use before generating responses to personalize based on user history.',
      paramsSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_all',
      description: 'Retrieve all stored memories for a user. Useful for debugging or displaying user profile.',
      paramsSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
          limit: { type: 'number', description: 'Max results (default 50)' },
        },
      },
    },
    {
      name: 'update',
      description: 'Update an existing memory by ID. Use when user corrects information.',
      paramsSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to update' },
          text: { type: 'string', description: 'New memory text' },
        },
        required: ['memoryId', 'text'],
      },
    },
    {
      name: 'delete',
      description: 'Delete a specific memory by ID.',
      paramsSchema: {
        type: 'object',
        properties: {
          memoryId: { type: 'string', description: 'Memory ID to delete' },
        },
        required: ['memoryId'],
      },
    },
    {
      name: 'delete_all',
      description: 'Delete all memories for a user. Use when user requests data reset.',
      paramsSchema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'User identifier' },
        },
      },
    },
  ],
  permissions: {
    allowedHosts: ['api.mem0.ai'],
  },
  source: 'marketplace' as const,
  enabled: true,
};

// ============================================================================
// Tool Builder
// ============================================================================

/**
 * Build Vercel AI tools from the mem0 power
 */
export async function buildMem0Tools(context: { userId?: string; sessionId?: string } = {}) {
  const { tool } = await import('ai');

  const userId = context.userId || 'default-user';
  const sessionId = context.sessionId;

  const tools: Record<string, any> = {};

  tools.mem0_add = tool({
    description: 'Store memories from a conversation for persistent context. Call after each user-agent interaction.',
    parameters: z.object({
      messages: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
      })),
      userId: z.string().optional(),
    }),
    execute: async (args: any) => mem0Add(args, { userId, sessionId }),
  } as any);

  tools.mem0_search = tool({
    description: 'Search memories for relevant context before responding. Use to personalize responses based on user history.',
    parameters: z.object({
      query: z.string(),
      userId: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async (args: any) => mem0Search(args, { userId, sessionId }),
  } as any);

  tools.mem0_get_all = tool({
    description: 'Retrieve all stored memories for a user.',
    parameters: z.object({
      userId: z.string().optional(),
      limit: z.number().optional(),
    }),
    execute: async (args: any) => mem0GetAll(args, { userId, sessionId }),
  } as any);

  tools.mem0_update = tool({
    description: 'Update an existing memory by ID.',
    parameters: z.object({
      memoryId: z.string(),
      text: z.string(),
    }),
    execute: async (args: any) => mem0Update(args, { userId, sessionId }),
  } as any);

  tools.mem0_delete = tool({
    description: 'Delete a specific memory by ID.',
    parameters: z.object({
      memoryId: z.string(),
    }),
    execute: async (args: any) => mem0Delete(args, { userId, sessionId }),
  } as any);

  tools.mem0_delete_all = tool({
    description: 'Delete all memories for a user.',
    parameters: z.object({
      userId: z.string().optional(),
    }),
    execute: async (args: any) => mem0DeleteAll(args, { userId, sessionId }),
  } as any);

  return tools;
}

// ============================================================================
// System Prompt Block
// ============================================================================

/**
 * Build system prompt with memory context (for auto-retrieval).
 *
 * - Drops memories below `threshold` (default 0.3) so noise doesn't pollute
 *   the LLM context.
 * - Sorts by descending score so the most relevant memories appear first.
 * - Includes the score so the model knows how confident the retrieval was.
 *
 * @param memories Array of memory objects to include in prompt
 * @param opts.threshold Minimum score; memories below this are dropped
 * @param opts.showScores Append score to each bullet (default: true)
 */
export function buildMem0SystemPrompt(
  memories: Mem0Memory[],
  opts: { threshold?: number; showScores?: boolean } = {}
): string {
  if (!memories || memories.length === 0) {
    return '';
  }

  const threshold = opts.threshold ?? 0.3;
  const showScores = opts.showScores ?? true;

  const filtered = memories
    .filter(m => m && typeof m.memory === 'string' && (m.score ?? 1) >= threshold)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (filtered.length === 0) {
    return '';
  }

  const memoryList = filtered
    .map(m => {
      if (showScores && typeof m.score === 'number') {
        return `- (${m.score.toFixed(2)}) ${m.memory}`;
      }
      return `- ${m.memory}`;
    })
    .join('\n');

  return `\n## Relevant User Memories\n\n${memoryList}\n`;
}

export function buildMem0SystemPromptLegacy(): string {
  return `
## Mem0 Persistent Memory

You have access to Mem0 for persistent memory storage and retrieval.

### When to use

1. **After each user interaction**: Call mem0_add to store the conversation for future context
2. **Before generating responses**: Call mem0_search to retrieve relevant memories and personalize
3. **User preferences**: Remember dietary restrictions, communication style, project preferences
4. **Context recall**: Remember previous discussions, decisions, code patterns used

### Available tools

- \`mem0_add\` - Store conversation memories
- \`mem0_search\` - Search for relevant context
- \`mem0_get_all\` - Get all user memories
- \`mem0_update\` - Update a memory
- \`mem0_delete\` - Delete a memory
- \`mem0_delete_all\` - Clear all user memories

### Integration pattern

1. At the start of a conversation, search for existing memories
2. Include relevant memories in your context
3. After each significant interaction, add the exchange to memory
4. When user provides preferences or corrections, update the memory

### Configuration

Requires MEM0_API_KEY environment variable. Get one at https://app.mem0.ai/dashboard/api-keys
`;
}