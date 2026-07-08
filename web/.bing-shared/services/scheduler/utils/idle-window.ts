/**
 * scheduler/utils/idle-window.ts
 *
 * Time-of-day idle-window check for the EventTriggerManager. When the
 * scheduler is in the configured quiet window, all event-driven triggers
 * (new-git-changes, marker-in-history) are suppressed — they do NOT get
 * enqueued, the underlying watcher keeps running but its `onTrigger`
 * callback is a no-op.
 *
 * Why a separate utility? Pure function = easy to unit test, no I/O.
 * Timezone-aware via Intl.DateTimeFormat — no external dep on luxon/dayjs.
 *
 * Overnight wrap: if `startTime` > `endTime` (e.g. 23:00 → 07:00), the
 * window is treated as crossing midnight. A time of 02:00 is "in the
 * window" because 02:00 <= 07:00.
 */

import type { IdleWindowConfig } from '../types'

/** Parse "HH:MM" to a minute-of-day integer in [0, 1439]. */
export function parseTimeOfDay(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) {
    throw new Error(`idle-window: invalid time "${hhmm}" — expected "HH:MM"`)
  }
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new Error(`idle-window: out-of-range time "${hhmm}"`)
  }
  return h * 60 + min
}

/**
 * Get the current minute-of-day in `timezone`. Uses Intl.DateTimeFormat
 * with hour12=false so we get 0-23 directly, then composes HH*60+MM.
 * Defaults to "UTC" if the timezone is unknown (Intl falls back).
 */
export function currentMinuteOfDay(timezone: string, now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(now)
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0'
  const minPart = parts.find((p) => p.type === 'minute')?.value ?? '0'
  // Intl returns "24" for midnight in some locales; normalize.
  const h = Number(hourPart) % 24
  const min = Number(minPart)
  return h * 60 + min
}

/**
 * Returns true if `now` falls inside the configured idle window.
 * If `config.enabled` is false, always returns false (never idle).
 */
export function isCurrentlyIdle(config: IdleWindowConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false
  let start: number
  let end: number
  try {
    start = parseTimeOfDay(config.startTime)
    end = parseTimeOfDay(config.endTime)
  } catch {
    // Bad config — fail open (NOT idle) so a typo doesn't silence triggers.
    return false
  }
  const cur = currentMinuteOfDay(config.timezone, now)
  if (start === end) {
    // Degenerate window of length 0 — treat as "not idle" (no-op).
    return false
  }
  if (start < end) {
    // Same-day window, e.g. 13:00 → 17:00.
    return cur >= start && cur < end
  }
  // Overnight window, e.g. 23:00 → 07:00. cur is "in" if >= start OR < end.
  return cur >= start || cur < end
}
