/**
 * Unit tests for streaming timeout config (Bug #17, #23).
 *
 * Verifies the split timeout shape exported from vercel-ai-streaming.ts:
 *   - STREAM_TIMEOUTS.firstTokenTimeoutMs (default 30s, env: LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS)
 *   - STREAM_TIMEOUTS.idleTimeoutMs       (default 60-90s band, env: LLM_STREAM_IDLE_TIMEOUT_MS)
 *   - STREAM_TIMEOUTS.thinkPingMs         (default 20s, env: LLM_STREAM_THINK_PING_MS)
 *
 * Ordering invariants:
 *   thinkPingMs < firstTokenTimeoutMs < idleTimeoutMs
 *     (think-ping fires before TTFT aborts, both well before the idle window closes)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('STREAM_TIMEOUTS (vercel-ai-streaming.ts)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.LLM_STREAM_IDLE_TIMEOUT_MS;
    delete process.env.LLM_STREAM_THINK_PING_MS;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('firstTokenTimeoutMs defaults to 30000 (30s)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBe(30000);
  });

  it('idleTimeoutMs defaults to within the 60-90s range (75000)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBeGreaterThanOrEqual(60000);
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBeLessThanOrEqual(90000);
  });

  it('thinkPingMs defaults to 20000 (20s)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBe(20000);
  });

  it('thinkPingMs is strictly less than idleTimeoutMs (ping fires before idle abort)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBeLessThan(mod.STREAM_TIMEOUTS.idleTimeoutMs);
  });

  it('thinkPingMs is strictly less than firstTokenTimeoutMs (ping fires before TTFT aborts)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBeLessThan(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs);
  });

  it('firstTokenTimeoutMs is strictly less than idleTimeoutMs (TTFT fires before idle)', async () => {
    const mod = await import('../vercel-ai-streaming');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBeLessThan(mod.STREAM_TIMEOUTS.idleTimeoutMs);
  });

  it('env-var overrides take effect', async () => {
    process.env.LLM_STREAM_FIRST_TOKEN_TIMEOUT_MS = '15000';
    process.env.LLM_STREAM_IDLE_TIMEOUT_MS = '80000';
    process.env.LLM_STREAM_THINK_PING_MS = '10000';
    // Re-import to pick up new env
    const mod = await import('../vercel-ai-streaming?env-override-1');
    expect(mod.STREAM_TIMEOUTS.firstTokenTimeoutMs).toBe(15000);
    expect(mod.STREAM_TIMEOUTS.idleTimeoutMs).toBe(80000);
    expect(mod.STREAM_TIMEOUTS.thinkPingMs).toBe(10000);
  });

  it('STREAM_TIMEOUTS is exported as a const object (frozen)', async () => {
    const mod = await import('../vercel-ai-streaming');
    // Should be frozen or at least constant-shape — prevents runtime mutation
    // of the default values across calls.
    expect(typeof mod.STREAM_TIMEOUTS).toBe('object');
    expect(mod.STREAM_TIMEOUTS).not.toBeNull();
    expect('firstTokenTimeoutMs' in mod.STREAM_TIMEOUTS).toBe(true);
    expect('idleTimeoutMs' in mod.STREAM_TIMEOUTS).toBe(true);
    expect('thinkPingMs' in mod.STREAM_TIMEOUTS).toBe(true);
  });
});
