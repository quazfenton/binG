/**
 * scheduler/trigger-manager.ts
 *
 * EventTriggerManager — orchestrates the event-driven trigger sources
 * (new-git-changes, marker-in-history) and routes their events into the
 * existing BullMQ scheduled-tasks queue. Cron-style repeatable jobs are
 * NOT touched by this manager — they keep running via the existing
 * `SchedulerService.registerRepeatable` path.
 *
 * Architecture:
 *   - Owns a Map<taskId, ActiveTrigger> of currently-running watchers.
 *   - `syncTriggers(tasks)` is the reconciliation point: callers invoke
 *     it after every CRUD change to ScheduledTask. It starts new
 *     watchers for new event-handler tasks, stops watchers for removed
 *     or disabled tasks, and updates config for changed ones.
 *   - Each watcher's onTrigger callback checks `isCurrentlyIdle` and,
 *     if not idle, enqueues a job via the injected scheduler service.
 *
 * The class is intentionally narrow — it knows nothing about Redis
 * persistence, the HTTP server, or the BullMQ worker. It just owns
 * watchers + idle gating + enqueue.
 */
import { GitWatcher } from './triggers/git-watcher'
import { MarkerTailingTrigger } from './triggers/marker-scanner'
import { isCurrentlyIdle } from './utils/idle-window'
import type {
  EventTriggerConfig,
  IdleWindowConfig,
  TriggerEvent,
  TriggerSource,
  TriggerStatus,
} from './types'

/** Subset of the SchedulerService API this manager depends on. */
export interface SchedulerServiceAPI {
  /** Persisted, in-memory task list (so we can read the latest config). */
  listTasks: () => Array<{ id: string; type: string; payload: any; enabled: boolean }>
  /**
   * Enqueue a trigger event onto the scheduler's BullMQ queue. Each
   * call enqueues a separate job (unique jobId) so the event-driven
   * jobs share the same queue/worker/rate-limiter as cron jobs.
   */
  enqueueTrigger: (taskId: string, triggerPayload: Record<string, any>) => Promise<string | null>
}

/** An active trigger source running for a particular task. */
interface ActiveTrigger {
  taskId: string
  source: TriggerSource
  target: string
  /** Stop / cleanup callback. */
  stop: () => Promise<void>
  /** Last fired timestamp. */
  lastFiredAt?: number
  /** Total fire count. */
  fireCount: number
  /** Last error message. */
  lastError?: string
}

const DEFAULT_IDLE: IdleWindowConfig = {
  enabled: false,
  startTime: '23:00',
  endTime: '07:00',
  timezone: 'UTC',
}

export class EventTriggerManager {
  private triggers: Map<string, ActiveTrigger> = new Map()
  private idleConfig: IdleWindowConfig = { ...DEFAULT_IDLE }
  private readonly log: (msg: string, ...rest: any[]) => void

  constructor(
    private readonly scheduler: SchedulerServiceAPI,
    log?: (msg: string, ...rest: any[]) => void,
  ) {
    this.log = log ?? ((msg, ...rest) => console.log(msg, ...rest))
  }

  /** Set or replace the idle-window config. */
  setIdleConfig(config: IdleWindowConfig): void {
    this.idleConfig = { ...config }
    this.log(`[EventTriggerManager] idle config: ${JSON.stringify(this.idleConfig)}`)
  }

  getIdleConfig(): IdleWindowConfig {
    return { ...this.idleConfig }
  }

  isCurrentlyIdle(): boolean {
    return isCurrentlyIdle(this.idleConfig)
  }

  /**
   * Reconcile active watchers with the current task list. Tasks of type
   * 'event-handler' with a non-empty `eventTrigger` field are kept
   * (or started); everything else is stopped.
   *
   * The contract is "set to this list" — adds, updates, and removals
   * are all derived by comparing against the existing map.
   */
  async syncTriggers(
    tasks: Array<{ id: string; type: string; payload: any; enabled: boolean }>,
  ): Promise<void> {
    // 1. Compute the desired set: taskId -> { source, target, config, enabled }.
    const desired = new Map<
      string,
      { source: TriggerSource; target: string; config: EventTriggerConfig; enabled: boolean }
    >()
    for (const t of tasks) {
      if (t.type !== 'event-handler' || !t.enabled) continue
      // The event-trigger config is stored in payload.eventTrigger.
      const cfg = (t.payload as any)?.eventTrigger as EventTriggerConfig | undefined
      if (!cfg || !cfg.source || !cfg.target) {
        this.log(`[EventTriggerManager] task ${t.id}: missing eventTrigger config, skipping`)
        continue
      }
      desired.set(t.id, {
        source: cfg.source,
        target: cfg.target,
        config: cfg,
        enabled: t.enabled,
      })
    }

    // 2. Stop triggers that are no longer in the desired set.
    for (const [taskId, active] of this.triggers) {
      if (!desired.has(taskId)) {
        await this.stopTrigger(taskId, active)
      }
    }

    // 3. Start or update the desired set.
    for (const [taskId, d] of desired) {
      const existing = this.triggers.get(taskId)
      if (existing && existing.source === d.source && existing.target === d.target) {
        // Unchanged — leave the running watcher alone.
        continue
      }
      // Changed (or new) — stop the old one, then start the new one.
      if (existing) await this.stopTrigger(taskId, existing)
      await this.startTrigger(taskId, d.source, d.target, d.config)
    }
  }

  /** Shut down all active triggers. Idempotent. */
  async shutdown(): Promise<void> {
    for (const [taskId, active] of this.triggers) {
      await this.stopTrigger(taskId, active)
    }
    this.triggers.clear()
  }

  /** Get the live status of all triggers — used by /triggers/status. */
  getStatus(): TriggerStatus {
    const triggers: TriggerStatus['triggers'] = []
    for (const a of this.triggers.values()) {
      triggers.push({
        taskId: a.taskId,
        source: a.source,
        target: a.target,
        enabled: true,
        lastFiredAt: a.lastFiredAt,
        fireCount: a.fireCount,
        lastError: a.lastError,
      })
    }
    return {
      idleConfig: this.getIdleConfig(),
      isCurrentlyIdle: this.isCurrentlyIdle(),
      triggers,
    }
  }

  // -- internals ------------------------------------------------------------

  private async startTrigger(
    taskId: string,
    source: TriggerSource,
    target: string,
    config: EventTriggerConfig,
  ): Promise<void> {
    let active: ActiveTrigger
    try {
      if (source === 'new-git-changes') {
        const watcher = new GitWatcher({
          watchPath: target,
          debounceMs: config.debounceMs,
          onTrigger: (evt) => this.handleEvent(taskId, evt),
          log: this.log,
        })
        await watcher.start()
        active = {
          taskId,
          source,
          target,
          stop: () => watcher.stop(),
          fireCount: 0,
        }
      } else if (source === 'marker-in-history') {
        const tailer = new MarkerTailingTrigger({
          logPath: target,
          pollIntervalMs: config.pollIntervalMs,
          onTrigger: (evt) => this.handleEvent(taskId, evt),
          log: this.log,
        })
        await tailer.start()
        active = {
          taskId,
          source,
          target,
          stop: () => tailer.stop(),
          fireCount: 0,
        }
      } else {
        this.log(`[EventTriggerManager] task ${taskId}: unknown source '${source}'`)
        return
      }
      this.triggers.set(taskId, active)
      this.log(`[EventTriggerManager] task ${taskId}: started ${source} on ${target}`)
    } catch (err: any) {
      // Record the error on a placeholder active entry so /triggers/status
      // surfaces it, but don't add the watcher to the map.
      this.log(
        `[EventTriggerManager] task ${taskId}: failed to start ${source} on ${target} — ${err.message}`,
      )
      this.triggers.set(taskId, {
        taskId,
        source,
        target,
        stop: async () => { /* nothing to stop */ },
        fireCount: 0,
        lastError: err.message,
      })
    }
  }

  private async stopTrigger(taskId: string, active: ActiveTrigger): Promise<void> {
    try {
      await active.stop()
    } catch (err: any) {
      this.log(`[EventTriggerManager] task ${taskId}: stop failed — ${err.message}`)
    }
    this.triggers.delete(taskId)
    this.log(`[EventTriggerManager] task ${taskId}: stopped ${active.source}`)
  }

  private async handleEvent(
    taskId: string,
    evt: TriggerEvent,
  ): Promise<void> {
    if (this.isCurrentlyIdle()) {
      // Suppress — record but don't enqueue. The active entry's lastFiredAt
      // is NOT updated (we want the operator-visible lastFiredAt to mean
      // "last actually-enqueued event").
      this.log(`[EventTriggerManager] task ${taskId}: idle window, suppressing ${evt.source}`)
      return
    }
    const active = this.triggers.get(taskId)
    if (active) {
      active.lastFiredAt = Date.now()
      active.fireCount++
    }
    evt.taskId = taskId
    try {
      await this.scheduler.enqueueTrigger(taskId, {
        triggerSource: evt.source,
        triggerPayload: evt.payload,
        triggerTimestamp: evt.timestamp,
      })
    } catch (err: any) {
      this.log(`[EventTriggerManager] task ${taskId}: enqueue failed — ${err.message}`)
      if (active) active.lastError = err.message
    }
  }
}
