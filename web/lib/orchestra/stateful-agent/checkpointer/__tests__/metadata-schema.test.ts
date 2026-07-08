/**
 * GitSnapshotWrapper metadata.json schema unit test (Tier 8 step 6 followup, 2026-07-08).
 *
 * Tests the new `ts` field in the metadata.json output (forward-compat with
 * the legacy `timestamp` field). The wrapper writes BOTH fields with identical
 * values per the doc spec (Tier 8 verdict-table row #6 of
 * `async-parallelization-opportunities.md`), so consumers can read either name.
 *
 * Why a dedicated schema test:
 *   - Locks in the `ts`/`timestamp` alias contract so a future refactor can't
 *     silently drop one of the two fields.
 *   - Validates the full schema surface (threadId / checkpointId / cwd /
 *     agentMetadata / git) per the doc spec.
 *   - Confirms the fire-and-forget side effect actually writes to disk and
 *     that re-put to the same (threadId, checkpointId) overwrites the prior
 *     snapshot (idempotent re-snapshot, not append).
 *   - Confirms the inner MemoryCheckpointer put() semantics are unchanged
 *     (no regression from the decorator).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  GitSnapshotWrapper,
  MemoryCheckpointer,
  createCheckpointer,
  type CheckpointerConfig,
} from '../index';

describe('GitSnapshotWrapper — metadata.json schema (Tier 8 step 6)', () => {
  let tempDir: string;
  let inner: MemoryCheckpointer;
  let wrapper: GitSnapshotWrapper;

  beforeAll(() => {
    // Override gitCheckpointsDir to a temp dir so the test doesn't touch
    // the real ~/.prompt-orchestrator/ tree.
    tempDir = mkdtempSync(join(tmpdir(), 'git-snapshot-test-'));
    inner = new MemoryCheckpointer();
    // gitRepoRoot = process.cwd() (real git repo) so the constructor's
    // `git rev-parse --show-toplevel` probe succeeds. gitTimeoutMs = 3000
    // bounds the test runtime even if git is slow under load.
    wrapper = new GitSnapshotWrapper(inner, {
      gitCheckpointsDir: tempDir,
      gitRepoRoot: process.cwd(),
      gitTimeoutMs: 3000,
    } satisfies CheckpointerConfig);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Wait for the fire-and-forget captureGitSnapshot to land on disk.
   * The wrapper.put() awaits inner.put() then schedules captureGitSnapshot
   * as a separate promise — the test must poll for the metadata.json file
   * rather than awaiting put() directly.
   *
   * Timeout is 10s (reviewer followup: 5s was too tight for a 295K-LOC
   * monorepo where `git status --porcelain` can exceed 3s under load).
   */
  const waitForSnapshot = async (
    threadId: string,
    checkpointId: string,
    timeoutMs = 10000,
  ): Promise<string> => {
    const metaPath = join(tempDir, threadId, checkpointId, 'metadata.json');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (existsSync(metaPath)) return metaPath;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `Snapshot metadata.json not written within ${timeoutMs}ms at ${metaPath}`,
    );
  };

  it('writes metadata.json with BOTH `timestamp` (legacy) and `ts` (new) fields equal (alias contract)', async () => {
    await wrapper.put('thread-schema-1', 'cp-1', { state: 'data' });
    const metaPath = await waitForSnapshot('thread-schema-1', 'cp-1');

    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

    // Both fields must be present and equal — the forward-compat contract.
    expect(meta.timestamp).toBeDefined();
    expect(meta.ts).toBeDefined();
    expect(meta.ts).toBe(meta.timestamp);

    // ts must be a valid ISO 8601 string (round-trips through Date)
    expect(typeof meta.ts).toBe('string');
    expect(new Date(meta.ts).toISOString()).toBe(meta.ts);
  });

  it('writes other required fields per doc spec (threadId, checkpointId, cwd, agentMetadata, git)', async () => {
    // Note: `agentMetadata` is the 4th arg of put() (the `metadata` param
    // captured by the wrapper), NOT the 3rd arg (the `state` arg that goes
    // to inner.put()). The test passes a distinct state object to make the
    // agentMetadata assertion unambiguous.
    await wrapper.put(
      'thread-schema-2',
      'cp-1',
      { unrelated: 'state-object' },
      { state: 'data', customKey: 'customValue' },
    );
    const metaPath = await waitForSnapshot('thread-schema-2', 'cp-1');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));

    expect(meta.threadId).toBe('thread-schema-2');
    expect(meta.checkpointId).toBe('cp-1');
    // cwd captures the Node process cwd at put() time (not the git root —
    // that's separately discoverable via meta.git.commit / meta.git.branch
    // or by the consumer's own `git rev-parse --show-toplevel`).
    expect(meta.cwd).toBe(process.cwd());
    // agentMetadata preserves the user-supplied metadata (4th arg) verbatim
    expect(meta.agentMetadata).toEqual({ state: 'data', customKey: 'customValue' });
    // git sub-object: 4 fields. The test environment IS a real git repo
    // (/opt/bing is a git repo, so commit/branch MUST be non-null strings).
    // We tighten the contract here: the wrapper promises to capture the
    // current commit + branch when git is available. status/diffStat can
    // be null (clean tree is the empty string "" which is truthy, but a
    // non-clean tree yields non-null values).
    expect(meta.git).toBeDefined();
    expect(meta.git.commit).toMatch(/^[0-9a-f]{40}$/); // full SHA-1
    expect(typeof meta.git.branch).toBe('string');
    expect((meta.git.branch as string).length).toBeGreaterThan(0);
    // status + diffStat: string or null (clean tree = ""; non-clean = content)
    for (const k of ['status', 'diffStat']) {
      expect(meta.git[k] === null || typeof meta.git[k] === 'string').toBe(true);
    }
  });

  it('overwrites prior snapshot for same (threadId, checkpointId) — idempotent re-snapshot', async () => {
    await wrapper.put(
      'thread-idempotent',
      'cp-A',
      { unrelated: 'state-v1' },
      { state: 'v1' },
    );
    const firstPath = await waitForSnapshot('thread-idempotent', 'cp-A');
    const first = JSON.parse(readFileSync(firstPath, 'utf-8'));
    const firstTs = first.ts;
    expect(firstTs).toBeDefined();

    // Wait so the second `ts` is strictly greater than the first
    // (ISO 8601 has 1ms precision; reviewer followup: 20ms was too short
    // on fast CI where both puts could land in the same millisecond).
    await new Promise((r) => setTimeout(r, 50));
    await wrapper.put(
      'thread-idempotent',
      'cp-A',
      { unrelated: 'state-v2' },
      { state: 'v2' },
    );

    // Poll for the new metadata.json to be re-written
    const deadline = Date.now() + 10000;
    let second: any;
    while (Date.now() < deadline) {
      const candidate = JSON.parse(readFileSync(firstPath, 'utf-8'));
      if (candidate.ts !== firstTs) {
        second = candidate;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(second).toBeDefined();
    expect(second.ts).not.toBe(firstTs);
    expect(new Date(second.ts).getTime()).toBeGreaterThan(
      new Date(firstTs).getTime(),
    );
    // agentMetadata reflects the second put's metadata (4th arg)
    expect(second.agentMetadata).toEqual({ state: 'v2' });
  });

  it('preserves the inner MemoryCheckpointer put() semantics (no decorator regression)', async () => {
    await wrapper.put('thread-inner', 'cp-1', { state: 'hello' });
    // inner.put() is awaited BEFORE the fire-and-forget side effect, so
    // the state is in MemoryCheckpointer immediately after put() returns.
    const stored = await inner.get('thread-inner', 'cp-1');
    expect(stored).toEqual({ state: 'hello' });
  });

  it('uses {} for agentMetadata when the 4th arg of put() is undefined (fallback contract)', async () => {
    // Doc spec: `agentMetadata: metadata || {}` — locks in the fallback
    // so a refactor can't accidentally drop the empty-object case (which
    // would make `JSON.stringify(meta)` include `null` or throw).
    await wrapper.put('thread-fallback', 'cp-1', { some: 'state' });
    const metaPath = await waitForSnapshot('thread-fallback', 'cp-1');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.agentMetadata).toBeDefined();
    expect(typeof meta.agentMetadata).toBe('object');
    expect(Object.keys(meta.agentMetadata).length).toBe(0);
  });

  it('createCheckpointer composes GitSnapshotWrapper when enableGitCheckpoints=true — composes a working put() through the factory', async () => {
    // Reviewer followup: assert more than instanceof — exercise an actual
    // put() through the factory-built wrapper and verify the metadata.json
    // lands. Tests 1-4 use a directly-constructed GitSnapshotWrapper; this
    // test confirms the factory composes the same wrapper with the same
    // side-effect semantics.
    const cp = createCheckpointer({
      enableGitCheckpoints: true,
      gitCheckpointsDir: tempDir,
      gitRepoRoot: process.cwd(),
      gitTimeoutMs: 3000,
    } satisfies CheckpointerConfig);
    expect(cp).toBeInstanceOf(GitSnapshotWrapper);

    await cp.put('thread-factory', 'cp-1', { via: 'factory' }, { key: 'value' });
    const metaPath = await waitForSnapshot('thread-factory', 'cp-1');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    expect(meta.threadId).toBe('thread-factory');
    expect(meta.checkpointId).toBe('cp-1');
    expect(meta.agentMetadata).toEqual({ key: 'value' });
  });

  it('createCheckpointer returns base checkpointer when enableGitCheckpoints is absent/false (no side effects)', async () => {
    const cpNoFlag = createCheckpointer({});
    const cpFalseFlag = createCheckpointer({ enableGitCheckpoints: false });
    expect(cpNoFlag).not.toBeInstanceOf(GitSnapshotWrapper);
    expect(cpFalseFlag).not.toBeInstanceOf(GitSnapshotWrapper);

    // Confirm a put() through the base checkpointer does NOT create a
    // metadata.json in the temp dir (i.e., the decorator is correctly
    // opt-in — not silently always-on).
    await cpNoFlag.put('thread-no-decorator', 'cp-1', { state: 'data' });
    // Wait briefly to ensure any side effect would have landed
    await new Promise((r) => setTimeout(r, 200));
    const metaPath = join(tempDir, 'thread-no-decorator', 'cp-1', 'metadata.json');
    expect(existsSync(metaPath)).toBe(false);
  });
});
