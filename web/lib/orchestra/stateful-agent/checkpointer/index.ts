import { exec, execFileSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface CheckpointerConfig {
  redisUrl?: string;
  prefix?: string;
  ttl?: number;
  enableGitCheckpoints?: boolean;
  gitCheckpointsDir?: string;
  /** Override cwd for git commands (defaults to `git rev-parse --show-toplevel` probe). */
  gitRepoRoot?: string;
  /** Per-command timeout for git exec calls (default 15000ms). */
  gitTimeoutMs?: number;
}

export interface Checkpointer {
  get(threadId: string, checkpointId: string): Promise<any | null>;
  put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void>;
  listCheckpoints(threadId: string, limit?: number): Promise<string[]>;
  getLatestCheckpointId(threadId: string): Promise<string | null>;
  deleteThread(threadId: string): Promise<void>;
}

export class RedisCheckpointer implements Checkpointer {
  private redis: any;
  private prefix: string;
  private ttl: number;

  constructor(config?: CheckpointerConfig) {
    try {
      const Redis = require('ioredis');
      this.redis = new Redis(config?.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379');
    } catch {
      console.warn('[Checkpointer] Redis not available, using memory fallback');
      this.redis = null;
    }
    this.prefix = config?.prefix || 'agent:checkpoint:';
    this.ttl = config?.ttl || 86400;
  }

  private getKey(threadId: string, checkpointId: string): string {
    return `${this.prefix}${threadId}:${checkpointId}`;
  }

  async get(threadId: string, checkpointId: string): Promise<any | null> {
    if (!this.redis) return null;
    const key = this.getKey(threadId, checkpointId);
    const data = await this.redis.get(key);
    if (!data) return null;
    return JSON.parse(data);
  }

  async put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void> {
    if (!this.redis) return;
    const key = this.getKey(threadId, checkpointId);
    const data = JSON.stringify({ state, metadata: { ...metadata, created_at: new Date().toISOString() } });
    await this.redis.setex(key, this.ttl, data);
  }

  async listCheckpoints(threadId: string, limit = 10): Promise<string[]> {
    if (!this.redis) return [];
    const pattern = `${this.prefix}${threadId}:*`;
    const keys = await this.redis.keys(pattern);
    return keys.slice(-limit).map((k: string) => k.replace(`${this.prefix}${threadId}:`, ''));
  }

  async getLatestCheckpointId(threadId: string): Promise<string | null> {
    if (!this.redis) return null;
    const checkpoints = await this.listCheckpoints(threadId, 1000);
    return checkpoints[checkpoints.length - 1] || null;
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!this.redis) return;
    const pattern = `${this.prefix}${threadId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}

export class MemoryCheckpointer implements Checkpointer {
  private store: Map<string, { state: any; metadata?: Record<string, any> }> = new Map<string, { state: any; metadata?: Record<string, any> }>();
  private ttl: number;

  constructor(config?: { ttl?: number }) {
    this.ttl = config?.ttl || 3600;
  }

  private getKey(threadId: string, checkpointId: string): string {
    return `${threadId}:${checkpointId}`;
  }

  async get(threadId: string, checkpointId: string): Promise<any | null> {
    const key = this.getKey(threadId, checkpointId);
    const entry = this.store.get(key);
    return entry?.state || null;
  }

  async put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void> {
    const key = this.getKey(threadId, checkpointId);
    this.store.set(key, { state, metadata });
    if (this.ttl > 0) {
      setTimeout(() => this.store.delete(key), this.ttl * 1000);
    }
  }

  async listCheckpoints(threadId: string, limit = 10): Promise<string[]> {
    const prefix = `${threadId}:`;
    return Array.from(this.store.keys())
      .filter(k => k.startsWith(prefix))
      .slice(-limit)
      .map(k => k.replace(prefix, ''));
  }

  async getLatestCheckpointId(threadId: string): Promise<string | null> {
    const checkpoints = await this.listCheckpoints(threadId, 1000);
    return checkpoints[checkpoints.length - 1] || null;
  }

  async deleteThread(threadId: string): Promise<void> {
    const prefix = `${threadId}:`;
    // NEW-1 followup-d at `lib/orchestra/stateful-agent/checkpointer/index.ts` (deleteThread, L127-L136);
    // wrap the Map keys() iterator in Array.from(...) to silence file-mode
    // tsc's TS2802 ("Type 'MapIterator<string>' can only be iterated
    // through when using the '--downlevelIteration' flag or with a
    // '--target' of 'es2015' or higher"). The project tsconfig.json has
    // `target: ES2020` + `downlevelIteration: true` so project-mode tsc
    // (`tsc -p .`) does NOT report the error — only file-mode tsc
    // (`tsc --noEmit --skipLibCheck <files>`) does, because passing
    // individual files to tsc bypasses the tsconfig's target/iteration
    // settings. Array.from materializes the iterator eagerly, which is
    // safe here (deleteThread is not a hot path) and lets the same code
    // pass under both tsc invocations. No semantic change.
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * GitSnapshotWrapper: decorator that captures a git snapshot (status --porcelain,
 * diff --stat, full diff patch, current commit, current branch, cwd, timestamp)
 * as a side-effect of put(). Each snapshot is written to
 * `~/.prompt-orchestrator/checkpoints/{threadId}/{checkpointId}/{metadata.json,changes.patch}`.
 *
 * The snapshot is captured in the background (fire-and-forget) so put() is not
 * blocked by git I/O. Errors are logged via console.warn and never propagated.
 *
 * Brainstorm step 3 (2026-07-08): "git checkpointing + file diff artifacts" —
 * gives the prompt-orchestrator an auditable timeline of repo state at each
 * checkpoint without coupling the checkpointer to a specific git workflow.
 *
 * OPT-IN: only wraps if CheckpointerConfig.enableGitCheckpoints is true.
 */
export class GitSnapshotWrapper implements Checkpointer {
  private gitCheckpointsDir: string;
  private cwdForGit: string;
  private gitTimeoutMs: number;
  private isGitAvailable: boolean;
  private hasWarnedMissingGit: boolean = false;

  constructor(private inner: Checkpointer, config?: CheckpointerConfig) {
    const home = os.homedir();
    this.gitCheckpointsDir = config?.gitCheckpointsDir || path.join(home, '.prompt-orchestrator', 'checkpoints');
    this.gitTimeoutMs = config?.gitTimeoutMs ?? 15000;

    // Detect git binary availability ONCE in the constructor. The result is
    // surfaced via a one-time warn on first put() so callers can debug
    // "why is my snapshot empty?" without crashing.
    this.isGitAvailable = true;
    try {
      execFileSync('git', ['--version'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      });
    } catch {
      this.isGitAvailable = false;
    }

    // Auto-detect the actual git repo root via `git rev-parse --show-toplevel`.
    // Falls back to the explicit config or process.cwd() if the probe fails.
    try {
      const probeCwd = config?.gitRepoRoot || process.cwd();
      const probe = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: probeCwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      });
      this.cwdForGit = probe.toString().trim() || config?.gitRepoRoot || process.cwd();
    } catch {
      this.cwdForGit = config?.gitRepoRoot || process.cwd();
    }
  }

  // Forward all read/delete operations unchanged
  get(threadId: string, checkpointId: string) { return this.inner.get(threadId, checkpointId); }
  listCheckpoints(threadId: string, limit?: number) { return this.inner.listCheckpoints(threadId, limit); }
  getLatestCheckpointId(threadId: string) { return this.inner.getLatestCheckpointId(threadId); }
  deleteThread(threadId: string) { return this.inner.deleteThread(threadId); }

  async put(threadId: string, checkpointId: string, state: any, metadata?: Record<string, any>): Promise<void> {
    // 1. Await the primary storage write
    await this.inner.put(threadId, checkpointId, state, metadata);

    // 2. One-time warn if git is unavailable (helps callers debug "why is
    // my snapshot empty?")
    if (!this.isGitAvailable && !this.hasWarnedMissingGit) {
      this.hasWarnedMissingGit = true;
      console.warn('[GitCheckpoint] git binary not found or not a git repo — snapshots will have null git fields. Set CheckpointerConfig.gitRepoRoot to override auto-detection.');
    }

    // 3. Fire-and-forget the git side effect (errors logged, never propagated)
    this.captureGitSnapshot(threadId, checkpointId, metadata).catch(err => {
      console.warn(`[GitCheckpoint] Failed to capture git snapshot for ${threadId}/${checkpointId}: ${err?.message || err}`);
    });
  }

  private async captureGitSnapshot(threadId: string, checkpointId: string, metadata?: Record<string, any>): Promise<void> {
    const targetDir = path.join(this.gitCheckpointsDir, threadId, checkpointId);
    await fs.mkdir(targetDir, { recursive: true });

    // cwd uses this.cwdForGit (auto-detected or explicit) so the snapshot
    // captures the right repo even if the Node process is launched from
    // a different directory (e.g. a sub-agent running in /opt/bing/web/).
    // timeout is configurable via CheckpointerConfig.gitTimeoutMs (default 15s).
    const execOpts = { cwd: this.cwdForGit, timeout: this.gitTimeoutMs };

    // Run git commands in parallel (any failure is isolated via Promise.allSettled)
    const [statusCmd, diffStatCmd, diffCmd, commitCmd, branchCmd] = await Promise.allSettled([
      execAsync('git status --porcelain', execOpts),
      execAsync('git diff --stat', execOpts),
      execAsync('git diff', execOpts),
      execAsync('git rev-parse HEAD', execOpts),
      execAsync('git rev-parse --abbrev-ref HEAD', execOpts),
    ]);

    const getValue = (result: PromiseSettledResult<{ stdout: string; stderr: string }>) =>
      result.status === 'fulfilled' ? result.value.stdout.trim() : null;

    // NEW-1 followup-d at `lib/orchestra/stateful-agent/checkpointer/index.ts` (Tier 8 step 6);
    // promote the existing diff side-effect from step 3 to a first-class
    // artifact: the per-checkpoint `changes.patch` file + `metadata.json` index
    // are now the canonical surfaces for grep/cat by operators / step 7a
    // git-watcher / step 9 (UI) — no checkout required. Doc spec (Tier 8
    // verdict-table row #6 of `async-parallelization-opportunities.md`) calls
    // for `ts` (not `timestamp`) in the index — write both for forward-compat
    // with legacy readers (zero production callers today per recon, but
    // preserves the prior field for any in-flight operator tooling). The
    // `git` sub-object already carries `commit/branch/status/diffStat` per
    // the doc spec. Structural-safety: extends an existing fire-and-forget
    // side-effect, no new dependencies, no changes to
    // `RedisCheckpointer.put()` semantics. ~0ms/put cost (work already done
    // in step 3's `Promise.allSettled` git-command fan-out).
    const ts = new Date().toISOString();
    const snapshotMeta = {
      timestamp: ts,
      ts,
      threadId,
      checkpointId,
      cwd: process.cwd(),
      agentMetadata: metadata || {},
      git: {
        commit: getValue(commitCmd),
        branch: getValue(branchCmd),
        status: getValue(statusCmd),
        diffStat: getValue(diffStatCmd),
      },
    };

    const diffOutput = getValue(diffCmd);

    // Write to disk (idempotent: overwrites prior snapshot for same threadId+checkpointId)
    await fs.writeFile(path.join(targetDir, 'metadata.json'), JSON.stringify(snapshotMeta, null, 2));
    if (diffOutput) {
      await fs.writeFile(path.join(targetDir, 'changes.patch'), diffOutput);
    }
  }
}

export function createCheckpointer(config?: CheckpointerConfig): Checkpointer {
  const useRedis = !!process.env.REDIS_URL || !!config?.redisUrl;

  let base: Checkpointer = useRedis
    ? new RedisCheckpointer(config)
    : new MemoryCheckpointer({ ttl: config?.ttl });

  if (config?.enableGitCheckpoints) {
    base = new GitSnapshotWrapper(base, config);
  }

  return base;
}
