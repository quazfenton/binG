/**
 * URL Store — Dual-backend storage for runtime configuration
 *
 * Stores the backend URL in two places:
 * 1. KV (primary) — fast, for runtime rotation
 * 2. R2 (fallback) — reliable, for when KV write quota is exceeded
 *
 * Resolution order for reading:
 *   1. KV key `runtime:BACKEND_URL`
 *   2. R2 object `config/backend-url.txt`
 *   3. env.BACKEND_URL (deploy-time default)
 *
 * This ensures the URL remains reachable even when KV write quota is exceeded.
 */
import type { Env } from './env';

export const RUNTIME_BACKEND_KEY = 'runtime:BACKEND_URL';
const R2_BACKEND_KEY = 'config/backend-url.txt';

// Tracks last time we attempted to write-back from R2 to KV.
// Used to avoid hammering KV with failed writes when quota is exhausted.
let lastWriteBackTimeMs = 0;

/**
 * Queue-based mutex for setBackendUrl to prevent concurrent write races.
 * Cloudflare Workers share module-level state across concurrent requests —
 * this serializes writes so KV/R2 stay consistent.
 *
 * Each caller chains onto the end of a promise queue. The synchronous
 * assignment to writeQueue means no two callers can share the same slot.
 */
let writeQueue: Promise<void> = Promise.resolve();

/**
 * Write the backend URL to both KV and R2.
 * KV is primary — if it fails, we still write to R2 as fallback.
 * Returns { kvSuccess: boolean, r2Success: boolean }
 *
 * Thread-safe: concurrent calls are serialized via queue-based mutex.
 */
export async function setBackendUrl(env: Env, url: string): Promise<{ kvSuccess: boolean; r2Success: boolean }> {
  // Chain onto the end of the write queue — safe because the assignment
  // to writeQueue is synchronous (no preemption between .then and assignment)
  const myTurn = writeQueue.then(() => {});
  writeQueue = myTurn;
  await myTurn;

  try {
    return await doSetBackendUrl(env, url);
  } finally {
    // Release is implicit: the next caller's .then() waits on our work
  }
}

async function doSetBackendUrl(env: Env, url: string): Promise<{ kvSuccess: boolean; r2Success: boolean }> {
  let kvSuccess = false;
  let r2Success = false;

  // Try KV first (primary)
  try {
    await env.BING_KV.put(RUNTIME_BACKEND_KEY, url);
    kvSuccess = true;
  } catch (err) {
    console.error('[url-store] KV put failed:', err instanceof Error ? err.message : String(err));
  }

  // Always try R2 as fallback (more reliable for quota issues)
  if (env.BING_STORAGE) {
    try {
      await env.BING_STORAGE.put(R2_BACKEND_KEY, url, {
        httpMetadata: { contentType: 'text/plain' },
      });
      r2Success = true;
    } catch (err) {
      console.error('[url-store] R2 put failed:', err instanceof Error ? err.message : String(err));
    }
  }

  return { kvSuccess, r2Success };
}

/**
 * Read the backend URL with cascading fallback.
 * Tries KV first, then R2, then env var.
 */
export async function getBackendUrl(env: Env): Promise<string> {
  // 1. Try KV (runtime override via admin endpoint) — primary source
  try {
    const kvValue = await env.BING_KV.get(RUNTIME_BACKEND_KEY);
    if (kvValue && isValidHttpUrl(kvValue)) {
      return stripTrailingSlash(kvValue);
    }
  } catch (err) {
    console.warn('[url-store] KV get failed, trying R2 fallback:', err instanceof Error ? err.message : String(err));
  }

  // 2. Try R2 fallback (only if R2 binding is configured)
  if (env.BING_STORAGE) {
    try {
      const r2Object = await env.BING_STORAGE.get(R2_BACKEND_KEY);
      if (r2Object) {
        const r2Value = await r2Object.text();
        if (r2Value && isValidHttpUrl(r2Value)) {
          console.log('[url-store] Using R2 fallback for backend URL');
          // Best-effort write-back: only attempt to sync R2 → KV every 60s to avoid
          // hammering KV with failed writes if quota is exhausted (each failed write
          // may still count toward the 1,000/day free tier limit).
          try {
            const now = Date.now();
            if (now - lastWriteBackTimeMs > 60_000) {
              lastWriteBackTimeMs = now;
              await env.BING_KV.put(RUNTIME_BACKEND_KEY, stripTrailingSlash(r2Value));
            }
          } catch {
            // Ignore - R2 has the value, that's what matters
          }
          return stripTrailingSlash(r2Value);
        }
      }
    } catch (err) {
      console.warn('[url-store] R2 get failed:', err instanceof Error ? err.message : String(err));
    }
  }

  // 3. Deploy-time env var — emergency escape hatch.
  //    Only used when KV and R2 are both unavailable.
  //    Set BACKEND_URL="" to re-enable runtime rotation.
  const envUrl = stripTrailingSlash(env.BACKEND_URL);
  if (envUrl && isValidHttpUrl(envUrl)) {
    return envUrl;
  }

  // 4. Nothing configured
  return '';
}

function stripTrailingSlash(u: string | undefined | null): string {
  if (!u) return '';
  return u.replace(/\/+$/, '');
}

function isValidHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}