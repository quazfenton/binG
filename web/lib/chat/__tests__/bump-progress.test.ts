import { describe, it, expect } from 'vitest';
import { bumpProgress, getLastProgressAt } from '../enhanced-llm-service';

describe('F2 progress tracker — bumpProgress + getLastProgressAt', () => {
  it('bumpProgress advances the timestamp', async () => {
    const initial = getLastProgressAt();
    // Sleep just enough to ensure Date.now() definitely ticks forward on any
    // reasonable system clock granularity (1ms is the typical V8 resolution).
    await new Promise((r) => setTimeout(r, 2));
    bumpProgress('tool-call-start');
    const post = getLastProgressAt();
    expect(post).toBeGreaterThan(initial);
  });

  it('getLastProgressAt is monotonic across multiple bumps', async () => {
    const baseline = getLastProgressAt();
    await new Promise((r) => setTimeout(r, 2));
    bumpProgress('tool-call-start');
    const afterStart = getLastProgressAt();
    await new Promise((r) => setTimeout(r, 2));
    bumpProgress('tool-call-complete');
    const afterComplete = getLastProgressAt();
    expect(afterStart).toBeGreaterThanOrEqual(baseline);
    expect(afterComplete).toBeGreaterThan(afterStart);
  });

  it('bumpProgress reason-string label does not affect the monotonic increment', async () => {
    const beforeA = getLastProgressAt();
    await new Promise((r) => setTimeout(r, 2));
    bumpProgress('reason-A-tool-call-start');
    const afterA = getLastProgressAt();

    const beforeB = getLastProgressAt();
    await new Promise((r) => setTimeout(r, 2));
    bumpProgress('reason-B-tool-call-complete');
    const afterB = getLastProgressAt();

    // Each call independently advances the tracker; the reason label is a
    // pure observation side-channel (logged via chatLogger.debug), not a key.
    expect(afterA).toBeGreaterThan(beforeA);
    expect(afterB).toBeGreaterThan(beforeB);
    // The two bumps are in the same monotonic direction; no rollback.
    expect(afterB).toBeGreaterThanOrEqual(afterA);
  });
});
