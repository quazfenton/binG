/**
 * Regression tests for the degradation-tracker module.
 *
 * Pass-2 cross-cutting theme: unified manualRepromptCounter + degradation-chain
 * log line. These tests cover the five core surfaces:
 *   1. recordDegradation appends events to the per-session chain
 *   2. startDegradationChain always creates a fresh chain (overwrites)
 *   3. manual-reprompt counter increments per session
 *   4. formatDegradationChain emits the canonical [Degradation-Chain] line
 *   5. The tracker is never-throw and never-blocks (defensive)
 */

import { describe, it, expect, beforeEach } from 'vitest';

const loadTracker = async () => {
  const mod = await import('@/lib/observability/degradation-tracker');
  mod._resetDegradationTrackerForTests();
  return mod;
};

describe('degradation-tracker (Pass-2 cross-cutting theme)', () => {
  beforeEach(async () => {
    const { _resetDegradationTrackerForTests } = await import('@/lib/observability/degradation-tracker');
    _resetDegradationTrackerForTests();
  });

  describe('recordDegradation + chain management', () => {
    it('recordDegradation appends events to the per-session chain', async () => {
      const { recordDegradation, getDegradationChain } = await loadTracker();
      recordDegradation('default', 'binary_missing', 'bash-tool', { baseCmd: 'npx' });
      recordDegradation('default', 'tool_name_alias_rewrite', 'router', { alias: 'list_directory' });
      const chain = getDegradationChain('default');
      expect(chain).not.toBeNull();
      expect(chain!.events.length).toBe(2);
      expect(chain!.counts.get('binary_missing')).toBe(1);
      expect(chain!.counts.get('tool_name_alias_rewrite')).toBe(1);
    });

    it('recordDegradation auto-starts a chain when none exists', async () => {
      const { recordDegradation, getDegradationChain } = await loadTracker();
      // No prior startDegradationChain call — recordDegradation auto-starts
      recordDegradation('default', 'success_false', 'router', { capabilityId: 'file.read' });
      const chain = getDegradationChain('default');
      expect(chain).not.toBeNull();
      expect(chain!.events.length).toBe(1);
    });

    it('startDegradationChain always creates a fresh chain (overwrites previous)', async () => {
      const { startDegradationChain, recordDegradation, getDegradationChain } = await loadTracker();
      // First request
      startDegradationChain('default');
      recordDegradation('default', 'binary_missing', 'bash-tool');
      const firstChain = getDegradationChain('default');
      expect(firstChain!.events.length).toBe(1);
      // Second request — startDegradationChain overwrites
      startDegradationChain('default');
      const secondChain = getDegradationChain('default');
      expect(secondChain!.events.length).toBe(0);
      // Old chain is overwritten
      expect(secondChain).not.toBe(firstChain);
    });

    it('isolates chains per sessionId', async () => {
      const { recordDegradation, getDegradationChain } = await loadTracker();
      recordDegradation('user-A', 'binary_missing', 'bash-tool');
      recordDegradation('user-B', 'tool_name_alias_rewrite', 'router');
      expect(getDegradationChain('user-A')!.events.length).toBe(1);
      expect(getDegradationChain('user-B')!.events.length).toBe(1);
      expect(getDegradationChain('user-A')!.events[0].kind).toBe('binary_missing');
      expect(getDegradationChain('user-B')!.events[0].kind).toBe('tool_name_alias_rewrite');
    });

    it('recordDeaggregation tolerates empty sessionId (uses "default")', async () => {
      const { recordDegradation, getDegradationChain } = await loadTracker();
      // @ts-expect-error testing defensive empty sessionId
      recordDegradation('', 'binary_missing', 'bash-tool');
      // @ts-expect-error testing defensive null sessionId
      recordDegradation(null, 'success_false', 'router');
      // @ts-expect-error testing defensive undefined sessionId
      recordDegradation(undefined, 'tool_name_alias_rewrite', 'router');
      const chain = getDegradationChain('default');
      expect(chain).not.toBeNull();
      expect(chain!.events.length).toBe(3);
    });
  });

  describe('clearDegradationChain', () => {
    it('sets the cleared flag but does not erase events', async () => {
      const { startDegradationChain, recordDegradation, clearDegradationChain, getDegradationChain } = await loadTracker();
      startDegradationChain('default');
      recordDegradation('default', 'binary_missing', 'bash-tool');
      clearDegradationChain('default');
      const chain = getDegradationChain('default');
      expect(chain!.cleared).toBe(true);
      // Events are preserved (for manual-reprompt detection on the next request)
      expect(chain!.events.length).toBe(1);
    });
  });

  describe('manual-reprompt counter', () => {
    it('starts at 0 for never-seen session', async () => {
      const { getManualRepromptCount } = await loadTracker();
      expect(getManualRepromptCount('default')).toBe(0);
    });

    it('incrementManualReprompt returns the new count', async () => {
      const { incrementManualReprompt, getManualRepromptCount } = await loadTracker();
      expect(incrementManualReprompt('user-A')).toBe(1);
      expect(incrementManualReprompt('user-A')).toBe(2);
      expect(incrementManualReprompt('user-A')).toBe(3);
      expect(getManualRepromptCount('user-A')).toBe(3);
    });

    it('tracks different sessions independently', async () => {
      const { incrementManualReprompt, getManualRepromptCount } = await loadTracker();
      incrementManualReprompt('user-A');
      incrementManualReprompt('user-B');
      incrementManualReprompt('user-A');
      expect(getManualRepromptCount('user-A')).toBe(2);
      expect(getManualRepromptCount('user-B')).toBe(1);
    });

    it('tolerates empty sessionId (uses "default")', async () => {
      const { incrementManualReprompt, getManualRepromptCount } = await loadTracker();
      // @ts-expect-error testing defensive empty sessionId
      expect(incrementManualReprompt('')).toBe(1);
      // @ts-expect-error testing defensive null sessionId
      expect(incrementManualReprompt(null)).toBe(2);
      // @ts-expect-error testing defensive undefined sessionId
      expect(incrementManualReprompt(undefined)).toBe(3);
      expect(getManualRepromptCount('default')).toBe(3);
    });

    it('resetManualRepromptCount clears the counter', async () => {
      const { incrementManualReprompt, resetManualRepromptCount, getManualRepromptCount } = await loadTracker();
      incrementManualReprompt('user-A');
      incrementManualReprompt('user-A');
      resetManualRepromptCount('user-A');
      expect(getManualRepromptCount('user-A')).toBe(0);
    });
  });

  describe('formatDegradationChain', () => {
    it('emits the canonical [Degradation-Chain] line for an empty chain', async () => {
      const { startDegradationChain, formatDegradationChain } = await loadTracker();
      const chain = startDegradationChain('default');
      const line = formatDegradationChain(chain);
      expect(line).toBe('[Degradation-Chain] session=default kinds=(none)');
    });

    it('emits sorted kinds with counts for a non-empty chain', async () => {
      const { startDegradationChain, recordDegradation, formatDegradationChain } = await loadTracker();
      const chain = startDegradationChain('default');
      recordDegradation('default', 'tool_name_alias_rewrite', 'router');
      recordDegradation('default', 'binary_missing', 'bash-tool');
      recordDegradation('default', 'binary_missing', 'bash-tool');
      const line = formatDegradationChain(chain);
      // Kinds sorted alphabetically: binary_missing before tool_name_alias_rewrite
      expect(line).toBe('[Degradation-Chain] session=default kinds=binary_missing(2) tool_name_alias_rewrite(1)');
    });

    it('emits "session=unknown kinds=(none)" for null chain', async () => {
      const { formatDegradationChain } = await loadTracker();
      expect(formatDegradationChain(null)).toBe('[Degradation-Chain] session=unknown kinds=(none)');
    });

    it('preserves sessionId verbatim (no PII stripping)', async () => {
      const { startDegradationChain, recordDegradation, formatDegradationChain } = await loadTracker();
      const chain = startDegradationChain('anon:1780963912001_a097129a4515a7fa67');
      recordDegradation('anon:1780963912001_a097129a4515a7fa67', 'binary_missing', 'bash-tool');
      const line = formatDegradationChain(chain);
      expect(line).toContain('session=anon:1780963912001_a097129a4515a7fa67');
    });
  });

  describe('defensive — never throws', () => {
    it('recordDegradation swallows errors gracefully', async () => {
      const { recordDegradation } = await loadTracker();
      // Pass a circular detail that can't be stringified — should NOT throw
      const circular: any = {};
      circular.self = circular;
      expect(() => recordDegradation('default', 'binary_missing', 'bash-tool', circular)).not.toThrow();
    });

    it('incrementManualReprompt handles bad sessionId gracefully', async () => {
      const { incrementManualReprompt } = await loadTracker();
      // @ts-expect-error testing defensive non-string sessionId
      expect(() => incrementManualReprompt(123)).not.toThrow();
      // @ts-expect-error testing defensive non-string sessionId
      expect(() => incrementManualReprompt({ weird: 'object' })).not.toThrow();
    });
  });

  describe('all 10 degradation kinds are accepted', () => {
    it('accepts every kind in the DegradationKind union', async () => {
      const { recordDegradation, getDegradationChain } = await loadTracker();
      const allKinds: Array<import('@/lib/observability/degradation-tracker').DegradationKind> = [
        'binary_missing',
        'tool_name_alias_rewrite',
        'capability_not_found',
        'broadcaster_epipe',
        'orchestration_fallback',
        'mid_stream_stall',
        'loop_abort',
        'invalid_path',
        'success_false',
        'custom',
      ];
      for (const kind of allKinds) {
        recordDegradation('default', kind, 'test-source');
      }
      const chain = getDegradationChain('default');
      expect(chain!.events.length).toBe(allKinds.length);
      for (const kind of allKinds) {
        expect(chain!.counts.get(kind)).toBe(1);
      }
    });
  });
});
