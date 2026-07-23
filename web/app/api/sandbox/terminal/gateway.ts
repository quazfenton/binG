import { NextRequest, NextResponse } from 'next/server';
import { resolveRequestAuth } from '@/lib/auth/request-auth';
import { sandboxBridge } from '@/lib/sandbox/sandbox-service-bridge';
import { terminalManager } from '@/lib/terminal/terminal-manager';
import { sandboxCreationRateLimiter } from '@/lib/utils/rate-limiter';
import { createLogger } from '@/lib/utils/logger';
import {
  getSandboxBindingService,
  type SandboxBinding,
  type SandboxProvider,
} from '@/lib/redis/sandbox-binding-service';

const logger = createLogger('TerminalAPI');

/**
 * Phase 1 — dual-write the new binding to Redis for cross-pod coordination.
 * The service is fail-open by design (see sandbox-binding-service.ts), so
 * a Redis hiccup here never propagates to the caller: the SQLite row is
 * the source of truth, the Redis write is just a fast-path cache.
 *
 * Mirrors the existing `inferProviderFromSandboxId` fallback chain used
 * at L93 of this file, so the provider field stays consistent.
 */
async function syncSandboxBindingToRedis(
  userId: string,
  sessionId: string,
  sandboxId: string,
): Promise<void> {
  const provider = (sandboxBridge.inferProviderFromSandboxId(sandboxId)
    || (process.env.SANDBOX_PROVIDER as any) || 'daytona') as SandboxProvider;
  const now = Date.now();
  const ttlSeconds = 24 * 60 * 60; // 24h — matches REDIS_BINDING_DEFAULT_TTL_SECONDS
  const binding: SandboxBinding = {
    sessionId,
    userId,
    sandboxId,
    wsUrl: `/api/sandbox/terminal/stream?sessionId=${encodeURIComponent(sessionId)}&sandboxId=${encodeURIComponent(sandboxId)}`,
    provider,
    createdAt: now,
    expiresAt: now + ttlSeconds * 1000,
    status: 'active',
  };
  await getSandboxBindingService().upsertBinding(binding, ttlSeconds);
}

// Track per-user sandbox creation failures to prevent infinite retry loops.
// When sandbox creation fails for a user, subsequent attempts are blocked
// for FAILURE_BACKOFF_MS (5 min) to avoid hammering provider APIs.
const USER_FAILURE_TRACKER_KEY = '__terminalSandboxFailure__';
const FAILURE_BACKOFF_MS = 300_000; // 5 minutes
interface SandboxFailureEntry {
  lastFailureAt: number;
  error: string;
}
function getSandboxFailureEntry(userId: string): SandboxFailureEntry | undefined {
  const map: Record<string, SandboxFailureEntry> | undefined = (globalThis as any)[USER_FAILURE_TRACKER_KEY];
  return map?.[userId];
}
function setSandboxFailureEntry(userId: string, error: string): void {
  const g = globalThis as any;
  if (!g[USER_FAILURE_TRACKER_KEY]) g[USER_FAILURE_TRACKER_KEY] = {};
  // Evict entries older than the backoff window to prevent unbounded growth.
  const now = Date.now();
  for (const key of Object.keys(g[USER_FAILURE_TRACKER_KEY])) {
    if (now - g[USER_FAILURE_TRACKER_KEY][key].lastFailureAt > FAILURE_BACKOFF_MS) {
      delete g[USER_FAILURE_TRACKER_KEY][key];
    }
  }
  g[USER_FAILURE_TRACKER_KEY][userId] = { lastFailureAt: now, error };
}
function clearSandboxFailureEntry(userId: string): void {
  const g = globalThis as any;
  if (g[USER_FAILURE_TRACKER_KEY]) delete g[USER_FAILURE_TRACKER_KEY][userId];
}

// Phase 1 — spam-suppression for the cache-miss observability line.
// Without this, a sustained Redis hiccup (where getBinding returns null due
// to fail-soft on a Redis error, not a true cache miss) would emit a warn
// line for EVERY existing-verify POST. At ~100 RPS that's ~6,000 warns per
// minute of outage — floods alerts and hides the rare natural-TTL-expiry
// events that genuinely deserve attention. Deliberate asymmetry from the
// per-user `__terminalSandboxFailure__` tracker above: cache-miss is a
// Redis-global concern (not per-user), so a single scalar timestamp is
// sufficient. A natural-expiry event hits warn after 24h of inactivity so
// the collision probability with hiccup noise is negligible.
const LAST_BINDING_WARN_KEY = '__bindingCacheMissLastWarnAt__';
const BINDING_WARN_SPAM_WINDOW_MS = 60_000;
function shouldEmitBindingCacheMissWarn(): boolean {
  const g = globalThis as any;
  const lastWarnAt = g[LAST_BINDING_WARN_KEY] as number | undefined;
  if (lastWarnAt != null && Date.now() - lastWarnAt < BINDING_WARN_SPAM_WINDOW_MS) {
    return false;
  }
  g[LAST_BINDING_WARN_KEY] = Date.now();
  return true;
}



/**
 * POST — Ensure user has a sandbox session ready for terminal use.
 * The actual PTY is created by the /terminal/stream SSE route.
 *
 * Authentication: Requires valid JWT token (anonymous not allowed for sandbox).
 * Rate Limiting: Max 3 sandbox creations per minute per user.
 */
export async function POST(req: NextRequest) {
  try {
    // ✅ REQUIRE AUTH (no anonymous for sandbox creation)
    const authResult = await resolveRequestAuth(req, { allowAnonymous: false });
    if (!authResult.success || !authResult.userId) {
      logger.warn('Terminal auth failed', { source: authResult.source });
      return NextResponse.json(
        { error: 'Authentication required. Please sign in to use the terminal.' },
        { status: 401 }
      );
    }

    // ✅ SANDBOX REQUIRES AUTHENTICATED USER (not anonymous)
    if (authResult.source === 'anonymous') {
      return NextResponse.json({
        error: 'Sandbox terminal requires authentication. Please sign in.',
        requiresAuth: true,
      }, { status: 401 });
    }

    // ✅ RATE LIMIT SANDBOX CREATION
    const rateLimit = sandboxCreationRateLimiter.check(authResult.userId);
    if (!rateLimit.allowed) {
      logger.warn('Sandbox creation rate limit exceeded', {
        userId: authResult.userId,
        retryAfter: rateLimit.retryAfter,
        blockedUntil: rateLimit.blockedUntil,
      });
      return NextResponse.json(
        {
          error: 'Too many sandbox creation requests',
          retryAfter: rateLimit.retryAfter,
          blockedUntil: rateLimit.blockedUntil,
        },
        { status: 429 }
      );
    }

    // Get existing sandbox session
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);

    // If session exists, verify the sandbox is still valid
    if (userSession) {
      const provider = sandboxBridge.inferProviderFromSandboxId(userSession.sandboxId)
        || (process.env.SANDBOX_PROVIDER as any) || 'daytona';

      try {
        // Try to get the sandbox - this will fail if it was destroyed
        const sandboxProvider = await sandboxBridge.getProvider(provider);
        await sandboxProvider.getSandbox(userSession.sandboxId);

        // ✅ Sandbox exists, return the session
        logger.debug('Existing sandbox session found', {
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
          userId: authResult.userId,
        });
        // Phase 1 — refresh the binding in Redis ONLY on cache miss.
        // On cache hit (the common case after the first POST in a session),
        // no Redis write happens — the existing binding's TTL counts down
        // naturally toward expiry. This is intentional: it forces a 24h
        // no-activity window before the binding is reaped from Redis, so a
        // long-quiet user does not pin a stale sandbox-mapping forever.
        // On cache miss (first POST, cluster restart, Redis eviction, or
        // natural TTL expiry), rehydrate so cross-pod routing resumes.
        const bindingService = getSandboxBindingService();
        const existingBinding = await bindingService.getBinding(userSession.sessionId);
        if (!existingBinding) {
          // Observability: this branch fires on every cache miss. In the steady
          // state (a true cache miss after natural TTL expiry) it's a few hits
          // per day per user. During a Redis hiccup, getBinding returning null
          // is fail-soft and we'd otherwise silently amplify Redis traffic 4x
          // (1 GET + 3 SET/SADD/EXPIRE per POST). Spam-suppressed via
          // shouldEmitBindingCacheMissWarn(): first miss in any 60s window
          // is warn-level (incident-visible viagrep); sustained misses demote
          // to debug to avoid 6k/min line floods during outages.
          if (shouldEmitBindingCacheMissWarn()) {
            logger.warn('Phase 1 binding cache miss — rehydrating into Redis', {
              sessionId: userSession.sessionId,
              userId: authResult.userId,
              provider: sandboxBridge.inferProviderFromSandboxId(userSession.sandboxId) || process.env.SANDBOX_PROVIDER || 'daytona',
            });
          } else {
            logger.debug('Phase 1 binding cache miss — suppressed (in 60s window after previous warn)', {
              sessionId: userSession.sessionId,
              userId: authResult.userId,
            });
          }
          await syncSandboxBindingToRedis(
            authResult.userId,
            userSession.sessionId,
            userSession.sandboxId,
          );
        }
        return NextResponse.json({
          sessionId: userSession.sessionId,
          sandboxId: userSession.sandboxId,
        });
      } catch (error: any) {
        // ✅ BETTER ERROR CLASSIFICATION
        const isNotFound = error?.status === 404 ||
                          error?.code === 'NOT_FOUND' ||
                          error?.message?.includes('not found') ||
                          error?.message?.includes('404');

        const isProviderUnavailable = error?.message?.includes('Invalid API key') ||
                                     error?.message?.includes('authentication') ||
                                     error?.message?.includes('Cannot read properties') ||
                                     error?.message?.includes('not available');

        if (isProviderUnavailable) {
          // Provider is unavailable, but session might still be valid
          // Don't delete the session - just try to create a new one with a different provider
          logger.warn('Provider unavailable, keeping session for fallback', {
            sandboxId: userSession.sandboxId,
            provider,
            error: error.message,
          });
        } else if (isNotFound) {
          // Sandbox truly doesn't exist, clean up the stale session
          logger.info('Stale session detected, cleaning up', {
            sandboxId: userSession.sandboxId,
            sessionId: userSession.sessionId,
          });
          sandboxBridge.deleteSession(userSession.sessionId);
        } else {
          // Other error - log but don't delete session (could be transient)
          logger.warn('Sandbox verification error (transient), keeping session', {
            sandboxId: userSession.sandboxId,
            error: error.message,
          });
          // Don't delete session on transient errors - allow retry
        }
        // Continue to create new session below
      }
    }

    // No valid session, create a new sandbox session.
    // Check per-user failure backoff to prevent infinite retry loops
    // when ALL providers are exhausted/circuit-broken.
    const failureEntry = getSandboxFailureEntry(authResult.userId);
    if (failureEntry) {
      const elapsed = Date.now() - failureEntry.lastFailureAt;
      if (elapsed < FAILURE_BACKOFF_MS) {
        logger.warn('Sandbox creation blocked by failure backoff', {
          userId: authResult.userId,
          elapsedMs: elapsed,
          backoffMs: FAILURE_BACKOFF_MS,
          lastError: failureEntry.error,
        });
        return NextResponse.json({
          error: 'Sandbox creation temporarily unavailable. Please wait a few minutes and try again.',
          retryAfter: Math.ceil((FAILURE_BACKOFF_MS - elapsed) / 1000),
          backoff: true,
        }, { status: 503 });
      }
      // Backoff expired, clear the entry and allow retry
      clearSandboxFailureEntry(authResult.userId);
    }

    try {
      const session = await sandboxBridge.getOrCreateSession(
        authResult.userId,
        { language: 'typescript' },
      );
      // Success — clear any previous failure entry
      clearSandboxFailureEntry(authResult.userId);
      // Phase 1 — dual-write binding to Redis (fail-open). If the service
      // throws (it shouldn't — it's fail-open), the SQLite source of truth
      // still has the row and the catch below returns 500.
      await syncSandboxBindingToRedis(
        authResult.userId,
        session.sessionId,
        session.sandboxId,
      );
      return NextResponse.json({
        sessionId: session.sessionId,
        sandboxId: session.sandboxId,
      }, { status: 201 });
    } catch (createError: any) {
      // Record failure with backoff to prevent infinite retry loops
      const errMsg = createError instanceof Error ? createError.message : String(createError);
      setSandboxFailureEntry(authResult.userId, errMsg);
      logger.error('Sandbox creation failed', {
        userId: authResult.userId,
        error: errMsg,
      });
      throw createError;
    }
  } catch (error) {
    logger.error('Create error:', error);
    return NextResponse.json({ error: 'Failed to create terminal session' }, { status: 500 });
  }
}

/**
 * DELETE — Kill the PTY session and optionally destroy the sandbox.
 * 
 * Authentication: Requires valid JWT token or session.
 * Authorization: User must own the session being deleted.
 */
export async function DELETE(req: NextRequest) {
  try {
    const authResult = await resolveRequestAuth(req, { allowAnonymous: true });
    if (!authResult.success || !authResult.userId) {
      logger.warn('Delete terminal auth failed', { source: authResult.source });
      return NextResponse.json(
        { error: 'Unauthorized: valid authentication token, session, or anonymous session required' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }

    // ✅ VERIFY SESSION OWNERSHIP
    const userSession = sandboxBridge.getSessionByUserId(authResult.userId);
    if (!userSession || userSession.sessionId !== sessionId) {
      logger.warn('Unauthorized terminal delete attempt', {
        userId: authResult.userId,
        requestedSessionId: sessionId,
        ownedSessionId: userSession?.sessionId,
      });
      return NextResponse.json(
        { error: 'Unauthorized: session does not belong to this user' },
        { status: 403 }
      );
    }

    logger.info('Killing terminal session', {
      sessionId,
      sandboxId: userSession.sandboxId,
      userId: authResult.userId,
    });
    
    await terminalManager.killTerminal(sessionId);

    // Phase 1 — drop the Redis binding so cross-pod routing stops returning
    // this session immediately. Fail-open: if Redis hiccups, the binding TTL
    // will eventually expire (24h) and the SQLite expireSession() call above
    // already marks the row as 'expired'.
    await getSandboxBindingService().deleteBinding(sessionId, authResult.userId);

    logger.info('Terminal session killed successfully', { sessionId });

    return NextResponse.json({ success: true });
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to kill terminal session', {
      error: err.message,
      stack: err.stack,
    });
    return NextResponse.json({ error: 'Failed to kill terminal session' }, { status: 500 });
  }
}
