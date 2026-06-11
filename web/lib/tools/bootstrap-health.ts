/**
 * Shared helper for emitting tool-bootstrap registration logs.
 *
 * Bug #12, #13, #24, #34 — the previous code emitted [INFO] `Registered 0
 * tools` for every tool registry (Composio, MCP-gateway, Arcade, Mem0) and
 * the misleading phrase `successfully registered 0 tools` made the degraded
 * case look like a success.
 *
 * New contract:
 *   - count > 0  →  [INFO]  `Registered N <registry> tools`        (preserved)
 *   - count === 0 → [WARN]  `registered 0 <registry> tools (degraded)` — visible
 *     at boot, makes missing config / auth / network errors obvious
 *
 * Use `logToolCount(logger, registry, count, extra?)` everywhere a tool
 * bootstrap function reports its outcome. The helper preserves the existing
 * `[INFO]` shape for the happy path so log-parsers and dashboards don't break.
 */
import type { Logger } from '@/lib/utils/logger';

export interface ToolCountLogContext {
  /** Registry / provider name (e.g. "Composio", "MCP gateway", "Arcade", "Mem0") */
  registry: string;
  /** Number of tools registered */
  count: number;
  /**
   * Optional extra context (e.g. number of toolkits, environment, duration).
   * Forwarded to the logger so operators can correlate.
   */
  extra?: Record<string, unknown>;
}

/**
 * Emit the right log line for a tool-bootstrap outcome.
 *
 * @param logger A `createLogger('<name>')` instance.
 * @param ctx    Registry name + count + optional context.
 */
export function logToolCount(
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>,
  ctx: ToolCountLogContext,
): void {
  const { registry, count, extra } = ctx;
  if (count > 0) {
    // Happy path: preserve the [INFO] shape verbatim so existing log
    // parsers / dashboards don't break.
    logger.info(`Registered ${count} ${registry} tools`, extra as any);
    return;
  }
  // Degraded path: [WARN] + the explicit "(degraded)" suffix so the
  // misleading "successfully registered 0 tools" wording is gone for good.
  logger.warn(
    `registered 0 ${registry} tools (degraded) — registry is configured but returned no tools. ` +
      `Check API keys, network reachability, and provider auth.`,
    extra as any,
  );
}
