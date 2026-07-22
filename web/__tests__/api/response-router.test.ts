/**
 * Unit tests for the ResponseEnvelope type + builders (2026-07-22).
 *
 * Verifies the cross-bug unification contract:
 * - Bug 3 (DIFF_MISMATCH cascade) — `errorRecoverableEnvelope({...currentFileContent, ...currentFileVersion})`
 * - Bug 2 (zombie streams 19+ min silence) — `idleApproachEnvelope` + `stallWatchdogEnvelope`
 * - Bug 1 (VFS session path normalization) — `scopeRejectedEnvelope({...expectedScopePrefix, ...correctedExample})`
 *
 * The builders must use `kind` discriminator + conditional-spread (present-iff-known,
 * NOT always-present-with-falsy-fallback) so downstream consumers pattern-match on
 * `envelope.kind` and access kind-specific metadata without TypeScript type guards.
 *
 * Reference: /opt/bing/.tickets/COMPREHENSIVE-BUG-AUDIT-AGENTIC-CHAT.md (cascade chain).
 */

import { describe, it, expect } from 'vitest';

import {
  successEnvelope,
  errorRecoverableEnvelope,
  errorFatalEnvelope,
  idleApproachEnvelope,
  stallWatchdogEnvelope,
  scopeRejectedEnvelope,
  type ResponseEnvelope,
} from '../../lib/api/response-router';

describe('ResponseEnvelope — cross-bug unification (2026-07-22)', () => {
  describe('successEnvelope', () => {
    it('builds kind=success envelope with data + timestamp + opts', () => {
      const env: ResponseEnvelope = successEnvelope({ foo: 'bar' }, { requestId: 'r1', conversationId: 'c1' });
      expect(env.kind).toBe('success');
      expect(env).toMatchObject({ data: { foo: 'bar' }, requestId: 'r1', conversationId: 'c1' });
      expect(typeof (env as any).timestamp).toBe('string');
      // Backward-compat: no error field on success arms
      expect((env as any).error).toBeUndefined();
    });
  });

  describe('errorRecoverableEnvelope — Bug 3 DIFF_MISMATCH', () => {
    it('builds kind=error_recoverable with conditional-spread currentFile metadata', () => {
      const env = errorRecoverableEnvelope({
        code: 'DIFF_MISMATCH',
        message: 'No SEARCH block matched',
        attemptedPath: 'lib/greet.ts',
        suggestedNextAction: 'Compare SEARCH block to currentFileContent',
        currentFileContent: 'export function greet() {}',
        currentFileVersion: 1,
      });
      expect(env.kind).toBe('error_recoverable');
      if (env.kind !== 'error_recoverable') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('DIFF_MISMATCH');
      expect(env.error.retryable).toBe(true);
      // Conditional-spread: BOTH content + version present
      expect(env.error.currentFileContent).toBe('export function greet() {}');
      expect(env.error.currentFileVersion).toBe(1);
    });

    it('omits currentFile metadata when not provided (present-iff-known)', () => {
      const env = errorRecoverableEnvelope({ code: 'X', message: 'y' });
      if (env.kind !== 'error_recoverable') throw new Error('type narrowing failed');
      expect(env.error.currentFileContent).toBeUndefined();
      expect(env.error.currentFileVersion).toBeUndefined();
    });
  });

  describe('errorFatalEnvelope', () => {
    it('builds kind=error_fatal with retryable=false', () => {
      const env = errorFatalEnvelope({ code: 'FATAL', message: 'cannot recover' });
      if (env.kind !== 'error_fatal') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('FATAL');
      expect(env.error.retryable).toBe(false);
    });
  });

  describe('idleApproachEnvelope — Bug 2 zombie-stream pre-emption', () => {
    it('builds kind=idle_approach with silenceMs + idleTimeoutMs', () => {
      const env = idleApproachEnvelope({
        silenceMs: 56000,
        idleTimeoutMs: 75000,
        streamId: 's-1',
        lastChunkAt: '2026-07-22T00:00:00Z',
      });
      expect(env.kind).toBe('idle_approach');
      if (env.kind !== 'idle_approach') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('IDLE_APPROACH');
      expect(env.error.silenceMs).toBe(56000);
      expect(env.idle.silenceMs).toBe(56000);
      expect(env.idle.idleTimeoutMs).toBe(75000);
      expect(env.idle.lastChunkAt).toBe('2026-07-22T00:00:00Z');
    });

    it('exposes a default code when not provided', () => {
      const env = idleApproachEnvelope({ silenceMs: 1, idleTimeoutMs: 100 });
      if (env.kind !== 'idle_approach') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('IDLE_APPROACH');
    });
  });

  describe('stallWatchdogEnvelope — Bug 2 terminal idle signal', () => {
    it('builds kind=stall_watchdog with msSinceLastChunk + reason', () => {
      const env = stallWatchdogEnvelope({
        msSinceLastChunk: 76000,
        reason: 'no_progress',
        streamId: 's-2',
      });
      expect(env.kind).toBe('stall_watchdog');
      if (env.kind !== 'stall_watchdog') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('STALL_WATCHDOG');
      expect(env.stall.msSinceLastChunk).toBe(76000);
      expect(env.stall.reason).toBe('no_progress');
      expect(env.streamId).toBe('s-2');
    });
  });

  describe('scopeRejectedEnvelope — Bug 1 VFS session path normalization', () => {
    it('builds kind=scope_rejected with expectedScopePrefix + correctedExample', () => {
      const env = scopeRejectedEnvelope({
        attemptedPath: 'package.json',
        expectedScopePrefix: 'workspace/sessions/{id}',
        correctedExample: {
          example: 'src/app.tsx',
          format: 'relative path like "src/app.tsx"',
          examples: ['src/App.tsx', 'README.md'],
        },
      });
      expect(env.kind).toBe('scope_rejected');
      if (env.kind !== 'scope_rejected') throw new Error('type narrowing failed');
      expect(env.error.code).toBe('SCOPE_REJECTED');
      expect(env.error.attemptedPath).toBe('package.json');
      expect(env.error.expectedScopePrefix).toBe('workspace/sessions/{id}');
      expect(env.error.correctedExample?.example).toBe('src/app.tsx');
      expect(env.scope.correctedExample?.example).toBe('src/app.tsx');
      expect(env.error.suggestedNextAction).toContain('src/app.tsx');
    });

    it('omits correctedExample when not provided', () => {
      const env = scopeRejectedEnvelope({
        attemptedPath: 'package.json',
        expectedScopePrefix: 'workspace/sessions/{id}',
      });
      if (env.kind !== 'scope_rejected') throw new Error('type narrowing failed');
      expect(env.error.correctedExample).toBeUndefined();
      expect(env.error.suggestedNextAction).toContain('list_files("/")');
    });
  });

  describe('cross-builder invariants', () => {
    it('every error envelope carries a string `code` for backward-compat with `error.code` parsers', () => {
      const envelopes: ResponseEnvelope[] = [
        errorRecoverableEnvelope({ code: 'C1', message: 'm' }),
        errorFatalEnvelope({ code: 'C2', message: 'm' }),
        idleApproachEnvelope({ silenceMs: 1, idleTimeoutMs: 100, code: 'C3' }),
        stallWatchdogEnvelope({ msSinceLastChunk: 1, reason: 'r', code: 'C4' }),
        scopeRejectedEnvelope({ attemptedPath: 'p', expectedScopePrefix: 's', code: 'C5' }),
      ];
      for (const env of envelopes) {
        if (env.kind === 'success') continue;
        expect(typeof env.error.code).toBe('string');
        expect(env.error.code.length).toBeGreaterThan(0);
        expect(typeof env.error.message).toBe('string');
        expect(typeof env.error.retryable).toBe('boolean');
      }
    });

    it('every envelope carries an ISO timestamp', () => {
      for (const env of [
        successEnvelope({}),
        errorRecoverableEnvelope({ code: 'C', message: 'm' }),
        idleApproachEnvelope({ silenceMs: 1, idleTimeoutMs: 100 }),
        stallWatchdogEnvelope({ msSinceLastChunk: 1, reason: 'r' }),
        scopeRejectedEnvelope({ attemptedPath: 'p', expectedScopePrefix: 's' }),
      ]) {
        expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      }
    });
  });
});
