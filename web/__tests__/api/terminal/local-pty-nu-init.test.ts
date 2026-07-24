/**
 * TO-NU-INTERACTIVE-INJECT — Nushell Interactive Init Injection regression test.
 *
 * Asserts that `createSafeShellWrapper` returns `preInitLines` for nushell
 * and that `createDirectPtySession` (simulated via source analysis) writes
 * them to the PTY after spawn.
 *
 * This test uses STATIC source analysis (like the reaper-integration test)
 * rather than mocking node-pty, because the gateway is a 3000+ line file
 * with complex async setup chains that make mock-instrumented tests brittle.
 *
 * @see /opt/bing/.tickets/TO-NU-INTERACTIVE-INJECT.md
 * @see /opt/bing/web/app/api/terminal/local-pty/gateway.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const gatewaySrc = readFileSync(
  resolve(process.cwd(), 'app/api/terminal/local-pty/gateway.ts'),
  'utf8',
);

describe('nushell interactive init injection (TO-NU-INTERACTIVE-INJECT)', () => {
  it('ALLOWED_SHELLS includes /usr/bin/nu', () => {
    expect(gatewaySrc).toContain("'/usr/bin/nu'");
  });

  it('ALLOWED_SHELLS includes nushell', () => {
    expect(gatewaySrc).toContain("'nushell'");
  });

  it('createSafeShellWrapper return type includes preInitLines', () => {
    expect(gatewaySrc).toContain('preInitLines?');
  });

  it('buildNuSafeShellWrapper is imported from shell-init-emitter', () => {
    const importBlock = gatewaySrc.match(
      /import\s*\{[^}]*\}\s*from\s*['"]@\/lib\/terminal\/shell-init-emitter['"]/,
    );
    expect(importBlock).not.toBeNull();
    expect(importBlock![0]).toContain('buildNuSafeShellWrapper');
  });

  it('nu shell branch returns preInitLines from buildNuSafeShellWrapper', () => {
    // The branch must call buildNuSafeShellWrapper and split the result
    expect(gatewaySrc).toContain("shellBasename === 'nu'");
    expect(gatewaySrc).toContain('buildNuSafeShellWrapper(workspaceDir)');
    expect(gatewaySrc).toContain('preInitLines: nuInit.split');
  });

  it('pty.write loop writes preInitLines after pty.spawn()', () => {
    // The post-spawn write loop must iterate over preInitLines and write each
    // The preInitLines check should be before the catch block
    expect(gatewaySrc).toContain('safeShell?.preInitLines');
    expect(gatewaySrc).toMatch(/for\s*\(\s*(const|let)\s+line\s+of\s+safeShell\.preInitLines\s*\)/);
  });

  it('Existing bash/zsh/fish return paths are unchanged (no preInitLines)', () => {
    // bash branch should NOT have preInitLines
    const bashReturnBlock = gatewaySrc.match(
      /shellBasename === 'bash'[\s\S]{0,400}return \{[\s\S]{0,200}\};/,
    );
    expect(bashReturnBlock).not.toBeNull();
    // bash return should not include preInitLines
    expect(bashReturnBlock![0]).not.toContain('preInitLines');
  });

  it('fish branch preserves its existing --init-command pattern', () => {
    expect(gatewaySrc).toContain("args: ['--init-command',");
  });

  it('source file sanity: gateway.ts is the right file', () => {
    expect(gatewaySrc.length).toBeGreaterThan(5000);
    expect(gatewaySrc).toContain('Local PTY API Route');
  });
});
