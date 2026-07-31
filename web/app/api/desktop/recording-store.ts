/**
 * Desktop Recorder Store
 *
 * Shared in-memory store for active DesktopRecorder instances per desktop sandbox ID.
 * Mirrors the pattern used in active-desktops.ts for desktop handle storage.
 *
 * In production this should be backed by Redis or similar distributed store.
 *
 * @see active-desktops.ts for the sibling desktop-handle store
 * @see e2b-desktop-recorder.ts for the DesktopRecorder class
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Desktop:RecorderStore');

// Lazy import to avoid pulling server-only code into client bundles
let DesktopRecorderClass: typeof import('@/lib/computer/e2b-desktop-recorder').DesktopRecorder | null = null;
let recorderImportPromise: Promise<void> | null = null;

async function ensureRecorderLoaded(): Promise<void> {
  if (DesktopRecorderClass) return;
  if (!recorderImportPromise) {
    recorderImportPromise = (async () => {
      const mod = await import('@/lib/computer/e2b-desktop-recorder');
      DesktopRecorderClass = mod.DesktopRecorder;
    })();
  }
  await recorderImportPromise;
}

export interface ActiveRecorder {
  recorder: import('@/lib/computer/e2b-desktop-recorder').DesktopRecorder;
  desktopId: string;
  userId: string;
  createdAt: number;
  lastUsed: number;
}

/** Map<desktopId, ActiveRecorder> */
const activeRecorders = new Map<string, ActiveRecorder>();

/**
 * Get the DesktopRecorder constructor reference (lazy-loaded).
 */
export async function getRecorderConstructor(): Promise<typeof import('@/lib/computer/e2b-desktop-recorder').DesktopRecorder> {
  await ensureRecorderLoaded();
  if (!DesktopRecorderClass) {
    throw new Error('DesktopRecorder module failed to load');
  }
  return DesktopRecorderClass;
}

/**
 * Register a recorder for a desktop sandbox.
 */
export function registerRecorder(recorder: import('@/lib/computer/e2b-desktop-recorder').DesktopRecorder, desktopId: string, userId: string): void {
  activeRecorders.set(desktopId, {
    recorder,
    desktopId,
    userId,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  });
  logger.info(`[RecorderStore] Registered recorder for desktop "${desktopId}"`);
}

/**
 * Unregister and return the recorder for a desktop sandbox.
 */
export function unregisterRecorder(desktopId: string): ActiveRecorder | undefined {
  const entry = activeRecorders.get(desktopId);
  if (entry) {
    activeRecorders.delete(desktopId);
    logger.info(`[RecorderStore] Unregistered recorder for desktop "${desktopId}"`);
  }
  return entry;
}

/**
 * Get the active recorder for a desktop sandbox.
 */
export function getRecorder(desktopId: string): ActiveRecorder | undefined {
  const entry = activeRecorders.get(desktopId);
  if (entry) {
    entry.lastUsed = Date.now();
  }
  return entry;
}

/**
 * Check if a user owns a recorder for the given desktop.
 */
export function verifyRecorderOwnership(desktopId: string, userId: string): boolean {
  const entry = activeRecorders.get(desktopId);
  return !!entry && entry.userId === userId;
}

/**
 * Get the count of active recorders.
 */
export function getActiveRecorderCount(): number {
  return activeRecorders.size;
}

/**
 * Clean up idle recorders (stale detection).
 * Removes recorders that haven't been touched since `staleThresholdMs`.
 * Does NOT stop the underlying recorder — the caller should do that
 * via the returned entries.
 */
export function collectStaleRecorders(staleThresholdMs = 30 * 60 * 1000): ActiveRecorder[] {
  const now = Date.now();
  const stale: ActiveRecorder[] = [];
  for (const [desktopId, entry] of activeRecorders) {
    if (now - entry.lastUsed > staleThresholdMs) {
      activeRecorders.delete(desktopId);
      stale.push(entry);
      logger.info(`[RecorderStore] Collected stale recorder for desktop "${desktopId}"`);
    }
  }
  return stale;
}
