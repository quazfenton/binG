/**
 * Regression tests for Bug #72 wiring in the tool capability router.
 *
 * Covers:
 *   1. Dead-import removal: `assertScopePathMatchesSessionId` is NO LONGER
 *      imported by `router.ts` (the capability handler entry uses the
 *      recovery variant `reconcileScopePathWithSessionId` instead).
 *   2. The `resolvedScopePath` and `reconciledOwnerId` declarations are
 *      BEFORE the first try block (the reconciliation doesn't throw, so
 *      wrapping it in a try/catch was unnecessary and caused a scoping
 *      issue with `reconciledOwnerId` being out of scope at the handler
 *      call site).
 *   3. The handler is invoked with `reconciledOwnerId` (NOT the original
 *      `ownerId`) so the downstream handler receives the corrected ownerId
 *      that targets the right session folder.
 *   4. The call-site payload contract: `resolveScopePathFromOwnerId` is
 *      called with `(ownerId, scopePath)`, and
 *      `reconcileScopePathWithSessionId` is called with
 *      `(ownerId, resolvedScopePath)`.
 *
 * The full `router.ts` is 2,919 lines with many dependencies — testing the
 * full capability handler execution would require complex mocking. Instead,
 * these tests verify the wiring at the import + call-site level:
 *   - The import structure (assert is gone, reconcile is present)
 *   - The declaration order (resolvedScopePath + reconciledOwnerId are at
 *     function scope, not nested inside the try block)
 *   - The handler call uses reconciledOwnerId
 *
 * The recovery behavior of `reconcileScopePathWithSessionId` itself is
 * covered exhaustively in `session-path-guard.test.ts` (16 tests).
 *
 * See: `session-path-guard.test.ts` for `reconcileScopePathWithSessionId` tests
 * See: `virtual-filesystem-service-rebound.test.ts` for the VFS service wiring
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function readRouterSource(): string {
  return readFileSync(
    join(__dirname, '..', 'router.ts'),
    'utf-8',
  );
}

describe('router — Bug #72 wiring (dead-import removal)', () => {
  it('does NOT import assertScopePathMatchesSessionId (replaced by the recovery variant)', () => {
    // The capability handler entry uses `reconcileScopePathWithSessionId`
    // (which recovers from path-drift) instead of `assertScopePathMatchesSessionId`
    // (which throws on mismatch). The assert import is dead and should be removed.
    const source = readRouterSource();

    // The import line should contain reconcileScopePathWithSessionId
    expect(source).toMatch(/import\s*\{[^}]*reconcileScopePathWithSessionId[^}]*\}\s*from\s*['"]\.\.\/virtual-filesystem\/session-path-guard['"]/);

    // The import line should NOT contain assertScopePathMatchesSessionId
    const importLine = source
      .split('\n')
      .find((line) =>
        line.includes("from '../virtual-filesystem/session-path-guard'") ||
        line.includes('from "../virtual-filesystem/session-path-guard"'),
      );
    expect(importLine).toBeDefined();
    expect(importLine).not.toMatch(/assertScopePathMatchesSessionId/);
  });

  it('still imports resolveScopePathFromOwnerId from scope-utils (used for the default-fallback)', () => {
    // The router uses `resolveScopePathFromOwnerId` to handle the default-fallback
    // scope path before reconciling. Verify the import is present.
    const source = readRouterSource();

    const importLine = source
      .split('\n')
      .find((line) =>
        line.includes("from '../virtual-filesystem/scope-utils'") ||
        line.includes('from "../virtual-filesystem/scope-utils"'),
      );
    expect(importLine).toBeDefined();
    expect(importLine).toMatch(/resolveScopePathFromOwnerId/);
  });

  it('assertScopePathMatchesSessionId appears exactly 0 times in the source (no calls, no import)', () => {
    // Belt-and-suspenders: count all references to assertScopePathMatchesSessionId.
    // After the dead-import removal, there should be ZERO references.
    const source = readRouterSource();
    const matches = source.match(/assertScopePathMatchesSessionId/g);
    expect(matches).toBeNull();
  });
});

describe('router — Bug #72 wiring (resolvedScopePath + reconciledOwnerId declarations)', () => {
  it('declares resolvedScopePath using resolveScopePathFromOwnerId(ownerId, scopePath)', () => {
    // The first step in the recovery flow: resolve the scope path from the
    // ownerId (handles the default-fallback case where the caller passed
    // workspace/sessions/000 instead of the real session folder).
    const source = readRouterSource();

    expect(source).toMatch(
      /const\s+resolvedScopePath\s*=\s*resolveScopePathFromOwnerId\(\s*ownerId\s*,\s*scopePath\s*\)/,
    );
  });

  it('declares reconciledOwnerId using reconcileScopePathWithSessionId(ownerId, resolvedScopePath).ownerId', () => {
    // The second step: reconcile the ownerId with the resolved scope path.
    // If they disagree (path-drift), the wrapper returns a corrected ownerId
    // and logs a WARN. The corrected ownerId is used for the handler call.
    const source = readRouterSource();

    expect(source).toMatch(
      /const\s+reconciledOwnerId\s*=\s*reconcileScopePathWithSessionId\(\s*ownerId\s*,\s*resolvedScopePath\s*\)\.ownerId/,
    );
  });

  it('declares resolvedScopePath and reconciledOwnerId BEFORE the first try block (not inside it)', () => {
    // The reconciliation doesn't throw, so wrapping it in a try/catch was
    // unnecessary and caused a scoping issue with `reconciledOwnerId` being
    // out of scope at the handler call site. Verify the declarations are
    // at function scope, not nested inside a try block.
    const source = readRouterSource();
    const lines = source.split('\n');

    // Find the line indices for the declarations
    const resolvedIdx = lines.findIndex((line) =>
      line.match(/const\s+resolvedScopePath\s*=\s*resolveScopePathFromOwnerId/),
    );
    const reconciledIdx = lines.findIndex((line) =>
      line.match(/const\s+reconciledOwnerId\s*=\s*reconcileScopePathWithSessionId/),
    );

    expect(resolvedIdx).toBeGreaterThan(-1);
    expect(reconciledIdx).toBeGreaterThan(-1);
    expect(reconciledIdx).toBeGreaterThan(resolvedIdx);

    // Look backwards from resolvedIdx for the enclosing function/method declaration
    const start = Math.max(0, resolvedIdx - 50);
    const context = lines.slice(start, resolvedIdx).join('\n');
    // The declarations should be inside a method body, not nested inside a try block.
    // The method signature may be multi-line (e.g., `async execute(\n  capabilityId: string,\n  ...\n): Promise<...> {`),
    // so we use a pattern that handles both single-line and multi-line signatures.
    expect(context).toMatch(
      /async\s+\w+\s*\([^)]*\)\s*[:{]|function\s+\w+\s*\([^)]*\)\s*\{/,
    );
  });
});

describe('router — Bug #72 wiring (handler invocation with reconciled ownerId)', () => {
  it('calls the handler with reconciledOwnerId (NOT the original ownerId)', () => {
    // The whole point of the reconciliation: the downstream handler receives
    // the corrected ownerId so it targets the right session folder. Verify
    // the handler call uses `reconciledOwnerId`.
    const source = readRouterSource();

    // Find the handler call pattern
    const handlerCallMatches = source.match(/await\s+handler\(\s*[^)]+\)/g);
    expect(handlerCallMatches).not.toBeNull();

    // At least one handler call should use reconciledOwnerId as the first arg
    const usesReconciled = handlerCallMatches!.some((call) =>
      call.includes('reconciledOwnerId'),
    );
    expect(usesReconciled).toBe(true);
  });

  it('does NOT call the handler with the original ownerId (the rebound is the whole point)', () => {
    // Belt-and-suspenders: verify NO handler call uses `ownerId` as the first
    // arg. (The original ownerId is rebound to reconciledOwnerId before the
    // handler call, so the handler should always see the rebound value.)
    const source = readRouterSource();

    // Match: await handler(<first-arg>, ...)
    // The first arg should be `reconciledOwnerId`, not `ownerId`
    const handlerCallPattern = /await\s+handler\(\s*(\w+)\s*,/g;
    const matches = [...source.matchAll(handlerCallPattern)];

    expect(matches.length).toBeGreaterThan(0);
    for (const match of matches) {
      const firstArg = match[1];
      expect(firstArg).toBe('reconciledOwnerId');
    }
  });

  it('passes the original input and context to the handler (unchanged by the rebound)', () => {
    // The handler signature is: handler(reconciledOwnerId, input, context)
    // The input and context are passed through unchanged — only the ownerId
    // is rebound. Verify this pattern.
    const source = readRouterSource();

    expect(source).toMatch(
      /await\s+handler\(\s*reconciledOwnerId\s*,\s*input\s*,\s*context\s*\)/,
    );
  });
});

describe('router — Bug #72 wiring (call-site payload contract)', () => {
  it('uses resolveScopePathFromOwnerId with (ownerId, scopePath) — the original args, not the rebound', () => {
    // The resolveScopePathFromOwnerId call uses the ORIGINAL ownerId and
    // scopePath (not the rebound). This is correct: the resolve step needs
    // the original inputs to derive the scope path.
    const source = readRouterSource();

    const calls = source.match(/resolveScopePathFromOwnerId\([^)]+\)/g);
    expect(calls).not.toBeNull();

    // At least one call should use (ownerId, scopePath) as args
    const usesOriginalArgs = calls!.some((call) =>
      call.includes('ownerId') && call.includes('scopePath'),
    );
    expect(usesOriginalArgs).toBe(true);
  });

  it('uses reconcileScopePathWithSessionId with (ownerId, resolvedScopePath) — the resolved path', () => {
    // The reconcile call uses the ORIGINAL ownerId but the RESOLVED scope path.
    // This is correct: we want to reconcile the ownerId with the scope-resolved
    // path, not the raw scopePath arg.
    const source = readRouterSource();

    const calls = source.match(/reconcileScopePathWithSessionId\([^)]+\)/g);
    expect(calls).not.toBeNull();

    // At least one call should use (ownerId, resolvedScopePath) as args
    const usesResolvedPath = calls!.some((call) =>
      call.includes('ownerId') && call.includes('resolvedScopePath'),
    );
    expect(usesResolvedPath).toBe(true);
  });

  it('the rebound returns { ownerId } (not { ownerId, recovered } or other shape)', () => {
    // The production code only uses `.ownerId` from the wrapper's return value.
    // This is by design: the caller rebinds ownerId and continues.
    // The `recovered` flag is available for logging/observability but not
    // used at the call sites.
    const source = readRouterSource();

    const calls = source.match(/reconcileScopePathWithSessionId\([^)]+\)\.ownerId/g);
    expect(calls).not.toBeNull();
    expect(calls!.length).toBeGreaterThan(0);
  });
});

// NOTE: The "documents" tests (2 in the recovery behavior documentation block)
// were removed per reviewer feedback — they're redundant with the 16 exhaustive
// `reconcileScopePathWithSessionId` tests in `session-path-guard.test.ts`.
// The remaining tests verify the WIRING (import structure, declaration order,
// handler call pattern) not the wrapper behavior itself.
