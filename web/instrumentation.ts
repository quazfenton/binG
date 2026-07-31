/**
 * Next.js Instrumentation File
 * 
 * Runs when the server starts - perfect for initializing databases, caches, etc.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * 
 * FORCE NODE.JS RUNTIME - This file initializes server-side resources
 * that require Node.js APIs (database, file system, etc.)
 */
export const runtime = 'nodejs';

/**
 * Initialize server resources
 * Uses dynamic import with bundler-resolved paths (@/ alias)
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // SEV-2: DO NOT swallow initialization failures. The previous version
    // wrapped mod.initializeServer() in a try/catch that logged and continued
    // — which silently defeated the SEV-2 hard-fail policy on SessionStore
    // persistence. We now log + rethrow so the orchestration layer (systemd,
    // pm2, Docker, k8s) sees a non-zero process exit and surfaces the
    // misconfiguration to the operator instead of running with in-memory state.
    const mod = await import('@/lib/backend/server-init');
    try {
      await mod.initializeServer();
    } catch (error) {
      console.error(
        '[Instrumentation] FATAL: server initialization failed — refusing to start. ' +
          '(For SEV-2 specifically, this means SessionStore fell back to in-memory and ' +
          'all session/OAuth/VFS state would be lost on restart.)',
        error,
      );
      // Rethrow so the process exits non-zero. Stack trace stays intact for diagnosis.
      throw error;
    }

    // Pre-warm the better-sqlite3 native binding so it is paid for during
    // server boot rather than on the first /api/auth/login request. Without
    // this warmup, the first call into getDatabase() triggers a one-time
    // ~800-1000ms native-binding JIT and schema setup that lands INSIDE
    // the b0→b1 gateway window and inflates the cold-path response time.
    //
    // Behavior:
    //   - AWAIT, not fire-and-forget. We want the warmup to finish BEFORE
    //     the HTTP port is bound so the first inbound request sees a warm
    //     binding. (Next.js runs register() before port-bind per its docs.)
    //   - Use the canonical connection-shim (NOT db.ts) — every other
    //     consumer routes through the shim, so warming the shim warms the
    //     same module that the gateway will hit.
    //   - HMR dedup via globalThis. Next.js dev hot-reload may re-evaluate
    //     this file; rerunning the warmup would log the same line twice.
    //     Same flag is read by server.ts so the custom-server boot path
    //     dedups against the default-cli path within a single process.
    //   - On fallback (nullDb) or throw, log a warn and CONTINUE. The
    //     warmup is a perf optimization, not a correctness invariant; the
    //     SEV-2 hard-fail obligation above already gates the real failure
    //     modes (SessionStore, etc.). Failing boot because the warmup
    //     didn't pre-cache anything would be the same mistake the SEV-2
    //     comment warned against, just shifted to the DB layer.
    const __warmupState__ = (globalThis as unknown as {
      __betterSqlite3Warmed__?: boolean;
    });
    if (!__warmupState__.__betterSqlite3Warmed__) {
      // Set the flag FIRST so a throw inside the warmup does not loop on
      // HMR re-evaluation. The cost of "we tried once and failed" beats
      // the cost of "we tried N times in a tight HMR cycle".
      __warmupState__.__betterSqlite3Warmed__ = true;
      const __t0__ = process.hrtime.bigint();
      try {
        const { getDatabase, isDatabaseConnectionCallable } = await import(
          '@/lib/database/connection-shim'
        );
        // Side-effecting call: triggers `new Database(...)` inside
        // connection.ts, which loads + JITs the better-sqlite3 native
        // binding ONCE for this process. Subsequent calls are O(1) reads
        // from the Node-cached binding handle.
        getDatabase();
        const __elapsedMs__ = Number(process.hrtime.bigint() - __t0__) / 1e6;
        if (!isDatabaseConnectionCallable()) {
          console.warn(
            `[Instrumentation] better-sqlite3 warmup completed in ${__elapsedMs__.toFixed(
              1,
            )}ms BUT shim fell through to nullDb fallback — native binding NOT pre-cached. ` +
              `First DB query will pay a degraded-init cost. (See [connection-shim] warn for root cause.)`,
          );
        } else {
          console.info(
            `[Instrumentation] better-sqlite3 native binding pre-loaded (${__elapsedMs__.toFixed(
              1,
            )}ms) — /api/auth/login cold-path b0→b1 will skip this cost on first hit`,
          );
        }
      } catch (err) {
        console.warn(
          `[Instrumentation] better-sqlite3 warmup threw after ${(
            Number(process.hrtime.bigint() - __t0__) / 1e6
          ).toFixed(1)}ms — boot continues; first DB query will retry the load inline. Error:`,
          err,
        );
      }
    }
  }
}
