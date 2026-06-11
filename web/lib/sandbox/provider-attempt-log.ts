/**
 * Shared helper for per-sandbox-provider per-attempt success/fail logging.
 *
 * Bug #12, #13, #24, #34 — the user asked for a per-sandbox-provider
 * per-attempt success/fail log so operators can see, at boot and at
 * runtime, exactly which provider is being tried and whether each attempt
 * succeeded or failed.
 *
 * Standard shape:
 *   - `provider X attempt N started`     (debug — quiet unless verbose)
 *   - `provider X attempt N success in Nms` (info on success)
 *   - `provider X attempt N failed: <err>` (warn on failure)
 *
 * Returns a small `ProviderAttemptLogger` with `start`, `success`, `fail`
 * methods so call sites stay terse. Pure (no I/O beyond the injected
 * logger), so it's safe to use in hot paths.
 */
import type { Logger } from '@/lib/utils/logger';

export interface ProviderAttemptOptions {
  /** Sandbox provider name (e.g. "e2b", "daytona", "codesandbox", "blaxel") */
  provider: string;
  /** Optional op / context (e.g. "createSandbox", "listTools") */
  op?: string;
  /** 1-indexed attempt number — surfaced in every log line */
  attempt: number;
  /** Optional extra context forwarded to the logger */
  extra?: Record<string, unknown>;
}

export interface ProviderAttemptLogger {
  /** Log the start of an attempt (debug). */
  start(): void;
  /** Log a successful attempt (info). Returns elapsed ms. */
  success(startMs?: number): number;
  /** Log a failed attempt (warn). */
  fail(error: unknown, startMs?: number): number;
}

/**
 * Build a per-attempt logger bound to a specific provider + attempt number.
 *
 * @example
 *   const log = providerAttemptLogger(logger, { provider: 'e2b', op: 'createSandbox', attempt: 1 });
 *   const t0 = Date.now();
 *   log.start();
 *   try {
 *     const handle = await e2b.createSandbox({ ... });
 *     log.success(t0);
 *     return handle;
 *   } catch (err) {
 *     log.fail(err, t0);
 *     throw err;
 *   }
 */
export function providerAttemptLogger(
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>,
  opts: ProviderAttemptOptions,
): ProviderAttemptLogger {
  const { provider, op, attempt, extra } = opts;
  const opSuffix = op ? ` ${op}` : '';
  const extraLog = extra ?? {};
  return {
    start() {
      logger.debug(
        `[${provider}]${opSuffix} attempt ${attempt} started`,
        extraLog as any,
      );
    },
    success(startMs?: number) {
      const elapsed =
        typeof startMs === 'number' ? Date.now() - startMs : 0;
      logger.info(
        `[${provider}]${opSuffix} attempt ${attempt} success (${elapsed}ms)`,
        { ...extraLog, elapsedMs: elapsed } as any,
      );
      return elapsed;
    },
    fail(error: unknown, startMs?: number) {
      const elapsed =
        typeof startMs === 'number' ? Date.now() - startMs : 0;
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : (() => {
                try {
                  return JSON.stringify(error);
                } catch {
                  return String(error);
                }
              })();
      logger.warn(
        `[${provider}]${opSuffix} attempt ${attempt} failed: ${message}`,
        { ...extraLog, elapsedMs: elapsed, error: message } as any,
      );
      return elapsed;
    },
  };
}
