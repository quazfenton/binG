/**
 * Unit tests for the startup-health-check helpers (Bug #12, #13, #24, #34).
 *
 * Covers:
 *   - `logToolCount`: [INFO] on count>0, [WARN] on count===0, "(degraded)"
 *     suffix, extra-context forwarding, fallback to mock logger
 *   - `providerAttemptLogger`: start/success/fail log lines, elapsed-ms
 *     computation, op-suffix formatting, error coercion (string/Error/object)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { logToolCount } from '../bootstrap-health';
import { providerAttemptLogger } from '../../sandbox/provider-attempt-log';

interface CapturedLog {
  level: 'info' | 'warn' | 'debug' | 'error';
  msg: string;
  meta?: any;
}

function makeMockLogger() {
  const calls: CapturedLog[] = [];
  return {
    calls,
    info: (msg: string, meta?: any) => calls.push({ level: 'info', msg, meta }),
    warn: (msg: string, meta?: any) => calls.push({ level: 'warn', msg, meta }),
    debug: (msg: string, meta?: any) => calls.push({ level: 'debug', msg, meta }),
    error: (msg: string, meta?: any) => calls.push({ level: 'error', msg, meta }),
  };
}

describe('logToolCount', () => {
  it('emits [INFO] `Registered N <registry> tools` for count>0', () => {
    const logger = makeMockLogger();
    logToolCount(logger, { registry: 'Composio', count: 7 });
    expect(logger.calls).toHaveLength(1);
    const c = logger.calls[0];
    expect(c.level).toBe('info');
    expect(c.msg).toBe('Registered 7 Composio tools');
  });

  it('emits [WARN] with (degraded) suffix for count===0', () => {
    const logger = makeMockLogger();
    logToolCount(logger, { registry: 'MCP gateway', count: 0 });
    expect(logger.calls).toHaveLength(1);
    const c = logger.calls[0];
    expect(c.level).toBe('warn');
    expect(c.msg).toContain('registered 0 MCP gateway tools (degraded)');
    expect(c.msg.toLowerCase()).toContain('api keys'); // hint text — should mention API keys check
  });

  it('forwards extra context to the logger', () => {
    const logger = makeMockLogger();
    logToolCount(logger, { registry: 'Arcade', count: 3, extra: { toolkits: 5, env: 'prod' } });
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].level).toBe('info');
    expect(logger.calls[0].meta).toEqual({ toolkits: 5, env: 'prod' });
  });

  it('handles missing extra without throwing', () => {
    const logger = makeMockLogger();
    logToolCount(logger, { registry: 'Mem0', count: 0 });
    expect(logger.calls[0].level).toBe('warn');
    expect(logger.calls[0].meta).toBeUndefined();
  });

  it('distinguishes each registry by name in the message', () => {
    const logger = makeMockLogger();
    logToolCount(logger, { registry: 'Mem0', count: 6 });
    logToolCount(logger, { registry: 'OAuth', count: 0 });
    expect(logger.calls[0].msg).toContain('Mem0');
    expect(logger.calls[1].msg).toContain('OAuth');
    expect(logger.calls[1].msg).toContain('(degraded)');
  });
});

describe('providerAttemptLogger', () => {
  let logger: ReturnType<typeof makeMockLogger>;
  beforeEach(() => {
    logger = makeMockLogger();
  });

  it('start() emits a debug line with provider + attempt', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', op: 'createSandbox', attempt: 1 });
    log.start();
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0].level).toBe('debug');
    expect(logger.calls[0].msg).toContain('[e2b]');
    expect(logger.calls[0].msg).toContain('createSandbox');
    expect(logger.calls[0].msg).toContain('attempt 1 started');
  });

  it('success() emits an info line with elapsed ms', () => {
    const log = providerAttemptLogger(logger, { provider: 'daytona', attempt: 1 });
    const t0 = Date.now() - 42; // pretend 42ms have passed
    const elapsed = log.success(t0);
    expect(elapsed).toBeGreaterThanOrEqual(42);
    expect(logger.calls[0].level).toBe('info');
    expect(logger.calls[0].msg).toContain('[daytona] attempt 1 success');
    expect(logger.calls[0].msg).toContain('ms');
    expect(logger.calls[0].meta.elapsedMs).toBeGreaterThanOrEqual(42);
  });

  it('fail() emits a warn line with the error message', () => {
    const log = providerAttemptLogger(logger, { provider: 'codesandbox', attempt: 2 });
    const err = new Error('rate limited');
    log.fail(err, Date.now() - 10);
    expect(logger.calls[0].level).toBe('warn');
    expect(logger.calls[0].msg).toContain('[codesandbox] attempt 2 failed');
    expect(logger.calls[0].msg).toContain('rate limited');
    expect(logger.calls[0].meta.error).toBe('rate limited');
  });

  it('coerces string errors into the warn line', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', attempt: 1 });
    log.fail('timeout reached');
    expect(logger.calls[0].msg).toContain('timeout reached');
  });

  it('coerces object errors via JSON.stringify', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', attempt: 1 });
    log.fail({ code: 500, reason: 'server' });
    expect(logger.calls[0].msg).toContain('500');
  });

  it('falls back to String() for circular / non-serializable errors', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', attempt: 1 });
    const circ: any = {};
    circ.self = circ;
    expect(() => log.fail(circ)).not.toThrow();
    expect(logger.calls[0].msg).toContain('failed');
  });

  it('includes the op suffix when provided', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', op: 'listTools', attempt: 3 });
    log.start();
    expect(logger.calls[0].msg).toContain('listTools');
    expect(logger.calls[0].msg).toContain('attempt 3');
  });

  it('omits the op suffix when not provided', () => {
    const log = providerAttemptLogger(logger, { provider: 'daytona', attempt: 1 });
    log.start();
    expect(logger.calls[0].msg).toBe('[daytona] attempt 1 started');
  });

  it('forwards extra context to every log call', () => {
    const log = providerAttemptLogger(logger, { provider: 'e2b', attempt: 1, extra: { workspaceId: 'ws-1' } });
    log.start();
    log.success(Date.now() - 5);
    log.fail(new Error('boom'), Date.now() - 10);
    for (const c of logger.calls) {
      expect(c.meta).toMatchObject({ workspaceId: 'ws-1' });
    }
  });
});
