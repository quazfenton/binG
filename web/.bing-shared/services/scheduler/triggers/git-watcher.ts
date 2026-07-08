/**
 * scheduler/triggers/git-watcher.ts
 *
 * `new-git-changes` trigger source. Watches a path (a file or directory)
 * inside a git working tree, debounces FS events, then on the debounce
 * timer fires:
 *   1. Find the latest prompt-orchestrator git checkpoint's commit hash
 *      under ~/.prompt-orchestrator/checkpoints/*/metadata.json.
 *   2. Run `git diff --stat <commit>` in the working tree.
 *   3. If the diff is non-empty, call the registered `onTrigger` callback
 *      with the diff stat + commit + cwd metadata.
 *
 * Why dynamic imports of chokidar + child_process? The scheduler is a
 * long-running service that must boot even if optional deps are missing
 * (e.g. running in a CI container without the dev watcher installed).
 * If chokidar isn't installed, `start()` returns a clear error and the
 * EventTriggerManager skips this task — cron jobs keep working.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { TriggerEvent } from '../types'

/** Subset of chokidar we need (typed as `any` to avoid the runtime import). */
type FSWatcher = {
  on: (event: string, listener: (...args: any[]) => void) => FSWatcher
  close: () => Promise<void>
}

export interface GitWatcherOptions {
  /** Path to watch — a file or a directory inside the working tree. */
  watchPath: string
  /** Debounce in ms. Default 2000. */
  debounceMs?: number
  /** Per-command timeout in ms for the git diff. Default 10000. */
  gitTimeoutMs?: number
  /** Override the checkpoint base dir. Defaults to ~/.prompt-orchestrator/checkpoints. */
  checkpointsDir?: string
  /** Trigger callback. */
  onTrigger: (event: TriggerEvent) => void | Promise<void>
  /** Optional logger for errors. Defaults to console. */
  log?: (msg: string, ...rest: any[]) => void
}

export class GitWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private inflight = false
  private readonly log: (msg: string, ...rest: any[]) => void

  constructor(private readonly opts: GitWatcherOptions) {
    this.log = opts.log ?? ((msg, ...rest) => console.log(msg, ...rest))
  }

  async start(): Promise<void> {
    // Dynamic import so the scheduler can boot without chokidar installed.
    let chokidar: any
    try {
      chokidar = (await import('chokidar')).default ?? (await import('chokidar'))
    } catch (err: any) {
      throw new Error(
        `GitWatcher: chokidar is not installed (${err.message}). Install it or disable new-git-changes triggers.`,
      )
    }
    const w: FSWatcher = chokidar.watch(this.opts.watchPath, {
      ignoreInitial: true,
      // Don't watch the .git dir internals — only the working tree.
      ignored: (p: string) => p.includes('/.git/'),
    }) as FSWatcher
    w.on('all', () => this.scheduleDiff())
    this.watcher = w
    this.log(`[GitWatcher] started watching ${this.opts.watchPath}`)
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watcher) {
      try {
        await this.watcher.close()
      } catch {
        // Best-effort close.
      }
      this.watcher = null
    }
    this.log(`[GitWatcher] stopped watching ${this.opts.watchPath}`)
  }

  private scheduleDiff(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.runDiff(), this.opts.debounceMs ?? 2000)
  }

  /**
   * Find the most recent prompt-orchestrator git checkpoint's commit hash.
   * Walks `<checkpointsDir>/*/metadata.json` (one folder per thread) and
   * returns the most recent commit found across all threads. Returns
   * undefined if no checkpoint exists yet.
   */
  private findLastCheckpointCommit(): { commit: string; threadId: string; ts: string } | undefined {
    const base = this.opts.checkpointsDir ?? join(homedir(), '.prompt-orchestrator', 'checkpoints')
    if (!existsSync(base)) return undefined
    let best: { commit: string; threadId: string; ts: string } | undefined
    try {
      const threadDirs = readdirSync(base, { withFileTypes: true })
      for (const td of threadDirs) {
        if (!td.isDirectory()) continue
        const threadId = td.name
        const tdPath = join(base, threadId)
        const cpDirs = readdirSync(tdPath, { withFileTypes: true })
        for (const cd of cpDirs) {
          if (!cd.isDirectory()) continue
          const metaPath = join(tdPath, cd.name, 'metadata.json')
          if (!existsSync(metaPath)) continue
          try {
            const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
            if (meta?.commit && typeof meta.commit === 'string') {
              if (!best || (meta.ts && meta.ts > best.ts) || !best.ts) {
                best = { commit: meta.commit, threadId, ts: meta.ts ?? '' }
              }
            }
          } catch {
            // Skip malformed metadata.json.
          }
        }
      }
    } catch {
      return undefined
    }
    return best
  }

  private async runDiff(): Promise<void> {
    if (this.inflight) return // Avoid concurrent git calls.
    this.inflight = true
    try {
      const baseline = this.findLastCheckpointCommit()
      if (!baseline) {
        // No baseline yet — skip. The first run will create a checkpoint.
        return
      }
      // Dynamic import so the scheduler boots even if the user removes git.
      let execFile: any
      try {
        execFile = (await import('node:child_process')).execFile
      } catch (err: any) {
        this.log(`[GitWatcher] node:child_process unavailable: ${err.message}`)
        return
      }
      const diffStat = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          'git',
          ['diff', '--stat', baseline.commit],
          { cwd: this.opts.watchPath, timeout: this.opts.gitTimeoutMs ?? 10000 },
          (err: any, stdout: string) => {
            if (err && err.code && err.code !== 0) {
              // git diff returns 0 even with differences; non-zero is a real error.
              reject(err)
            } else {
              resolve(stdout || '')
            }
          },
        )
        // Suppress unhandled 'error' event if child fails to spawn.
        child.on('error', () => { /* will reject above */ })
      })
      const diffStatTrimmed = diffStat.trim()
      if (!diffStatTrimmed) {
        // No changes since the last checkpoint.
        return
      }
      await this.opts.onTrigger({
        source: 'new-git-changes',
        taskId: '', // Filled in by EventTriggerManager.
        payload: {
          baselineCommit: baseline.commit,
          baselineThreadId: baseline.threadId,
          baselineTs: baseline.ts,
          diffStat: diffStatTrimmed,
          watchPath: this.opts.watchPath,
        },
        timestamp: Date.now(),
      })
    } catch (err: any) {
      this.log(`[GitWatcher] diff failed: ${err.message}`)
    } finally {
      this.inflight = false
    }
  }
}
