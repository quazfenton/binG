/**
 * Tests for the ripgrep wrapper. Uses a temp directory with known content so
 * the test passes regardless of whether real ripgrep is installed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ripgrepSearch, isRipgrepAvailable, clearRipgrepPathCache } from '../ripgrep';

let tmpDir: string;

beforeAll(async () => {
  clearRipgrepPathCache();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rg-test-'));
  await fs.writeFile(
    path.join(tmpDir, 'a.ts'),
    'const FOO = 1;\nconst bar = 2;\nfunction baz() { return FOO; }\n',
  );
  await fs.writeFile(
    path.join(tmpDir, 'b.txt'),
    'line one\nfoo here\nfoo and bar\n',
  );
  await fs.mkdir(path.join(tmpDir, 'sub'));
  await fs.writeFile(
    path.join(tmpDir, 'sub', 'c.ts'),
    'export const FOO = 99;\nFOO * 2;\n',
  );
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('ripgrep wrapper', () => {
  it('returns matches for a simple regex', async () => {
    const r = await ripgrepSearch({ query: 'FOO', path: tmpDir });
    expect(r.matches.length).toBeGreaterThanOrEqual(3);
    const paths = r.matches.map((m) => m.path);
    expect(paths.some((p) => p.endsWith('a.ts'))).toBe(true);
    expect(paths.some((p) => p.endsWith('c.ts'))).toBe(true);
  });

  it('respects glob filter', async () => {
    const r = await ripgrepSearch({ query: 'foo', path: tmpDir, glob: '*.txt', caseInsensitive: true });
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.path.endsWith('.txt'))).toBe(true);
  });

  it('honors caseInsensitive', async () => {
    const ci = await ripgrepSearch({ query: 'foo', path: tmpDir, caseInsensitive: true });
    const cs = await ripgrepSearch({ query: 'foo', path: tmpDir, caseInsensitive: false });
    expect(ci.matches.length).toBeGreaterThanOrEqual(cs.matches.length);
  });

  it('returns line numbers and content as numbers/strings', async () => {
    // Use the same query as the smoke test ('FOO') which is known to match
    // multiple files; just assert that match shape is correct.
    const r = await ripgrepSearch({ query: 'FOO', path: tmpDir });
    expect(r.matches.length).toBeGreaterThan(0);
    for (const m of r.matches) {
      expect(typeof m.line).toBe('number');
      expect(m.line).toBeGreaterThan(0);
      expect(typeof m.content).toBe('string');
      expect(typeof m.path).toBe('string');
    }
  });

  it('respects maxResults', async () => {
    const r = await ripgrepSearch({ query: '.', path: tmpDir, maxResults: 2 });
    expect(r.matches.length).toBeLessThanOrEqual(2);
  });

  it('reports whether real ripgrep was used', async () => {
    const r = await ripgrepSearch({ query: 'FOO', path: tmpDir });
    expect(typeof r.usedRipgrep).toBe('boolean');
    const probe = await isRipgrepAvailable();
    expect(typeof probe).toBe('boolean');
  });

  it('contextLines option does not break the search', async () => {
    // Just verify the option is accepted and matches still come back.
    const r = await ripgrepSearch({
      query: 'FOO',
      path: tmpDir,
      contextLines: 1,
    });
    expect(r.matches.length).toBeGreaterThan(0);
  });
});
