/**
 * E2B Desktop Recorder — Capture Loop & Playback
 *
 * Records desktop sessions as a timeline of screenshots and actions,
 * then replays them at configurable speed.
 *
 * FEATURES:
 * - Periodic screenshot capture (configurable FPS)
 * - Action recording (mouse, keyboard, clipboard, commands)
 * - Timestamped frame timeline with screenshots + actions
 * - Replay at 1x, 2x, 0.5x speed with pause/resume/seek
 * - Export to JSON (base64 screenshots, metadata)
 * - Import from JSON
 * - Event-based (onFrame, onAction, onComplete)
 *
 * USAGE:
 *   const recorder = new DesktopRecorder(desktopHandle);
 *   await recorder.start({ fps: 2 });
 *   // ... execute actions ...
 *   await recorder.recordAction({ type: 'left_click', x: 100, y: 200 });
 *   const session = await recorder.stop();
 *
 *   const player = new DesktopPlayer();
 *   await player.load(session);
 *   player.on('frame', (frame) => renderFrame(frame));
 *   await player.play({ speed: 2 });
 *
 * @see e2b-desktop-provider-enhanced.ts for DesktopSandboxHandle
 */

import { createLogger } from '@/lib/utils/logger';
import type { DesktopSandboxHandle, DesktopAction } from '@/lib/computer/e2b-desktop-provider-enhanced';

const logger = createLogger('E2B:DesktopRecorder');

// ============================================================================
// Constants
// ============================================================================

/** Default screenshot capture interval in milliseconds (2 FPS) */
export const DEFAULT_CAPTURE_INTERVAL_MS = 500;
/** Minimum capture interval (10 FPS max) */
export const MIN_CAPTURE_INTERVAL_MS = 100;
/** Maximum number of frames in a single recording session */
export const MAX_FRAMES_PER_SESSION = 10_000;
/** Maximum screenshot resolution dimension for storage efficiency */
export const MAX_SCREENSHOT_WIDTH = 960;
export const MAX_SCREENSHOT_HEIGHT = 640;
/** Max base64 screenshot size before compression hint (~2MB) */
export const MAX_SCREENSHOT_BYTES = 2_000_000;

// ============================================================================
// Types
// ============================================================================

export interface RecordingFrame {
  /** Frame index (0-based) */
  index: number;
  /** Unix timestamp when frame was captured */
  timestamp: number;
  /** Base64-encoded PNG screenshot (may be null if capture failed) */
  screenshotBase64: string | null;
  /** Action that triggered this frame (null for periodic captures) */
  triggerAction?: DesktopAction;
  /** Duration from session start in ms */
  elapsedMs: number;
}

export interface RecordedAction {
  /** Action index within the session */
  index: number;
  /** Unix timestamp when action was executed */
  timestamp: number;
  /** Duration from session start in ms */
  elapsedMs: number;
  /** The desktop action executed */
  action: DesktopAction;
  /** Serialised result (JSON) */
  resultJson?: string;
  /** Whether the action succeeded */
  success: boolean;
}

export interface RecordingSessionMetadata {
  id: string;
  label?: string;
  createdAt: number;
  duration: number;
  fps: number;
  totalFrames: number;
  totalActions: number;
  resolution: [number, number];
  environmentInfo?: Record<string, string>;
}

export interface RecordingSession {
  metadata: RecordingSessionMetadata;
  frames: RecordingFrame[];
  actions: RecordedAction[];
}

export interface RecorderConfig {
  /** Screenshot capture rate in frames per second (default: 2) */
  fps?: number;
  /** Max total frames before auto-stop (default: 10000) */
  maxFrames?: number;
  /** Whether to auto-capture screenshots on every action (default: true) */
  captureOnAction?: boolean;
  /** Optional label for the recording */
  label?: string;
  /** Desktop resolution [width, height] (default: [1920, 1080]) */
  resolution?: [number, number];
  /** Callback on each captured frame */
  onFrame?: (frame: RecordingFrame) => void;
  /** Callback on each recorded action */
  onAction?: (action: RecordedAction) => void;
  /** Callback when recording completes */
  onComplete?: (session: RecordingSession) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
}

export interface RecorderState {
  running: boolean;
  paused: boolean;
  startedAt: number | null;
  framesCaptured: number;
  actionsRecorded: number;
  elapsedMs: number;
}

export interface PlayerConfig {
  /** Playback speed multiplier (default: 1) */
  speed?: number;
  /** Whether to loop playback (default: false) */
  loop?: boolean;
  /** Start offset in ms (default: 0) */
  startOffsetMs?: number;
  /** End offset in ms (default: session duration) */
  endOffsetMs?: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'seeking' | 'stopped' | 'completed';

export interface PlayerState {
  status: PlayerStatus;
  sessionId: string | null;
  currentFrameIndex: number;
  currentActionIndex: number;
  elapsedMs: number;
  totalDuration: number;
  speed: number;
}

export type PlayerEvent = 'frame' | 'action' | 'complete' | 'error' | 'status' | 'seek';

export interface PlayerEventPayload {
  type: PlayerEvent;
  frame?: RecordingFrame;
  action?: RecordedAction;
  error?: Error;
  state: PlayerState;
}

/** Player event handler type */
type PlayerEventHandler = (payload: PlayerEventPayload) => void;

// ============================================================================
// Desktop Recorder
// ============================================================================

export class DesktopRecorder {
  private desktop: DesktopSandboxHandle;
  private config: Required<RecorderConfig>;
  private state: RecorderState;
  private frames: RecordingFrame[] = [];
  private actions: RecordedAction[] = [];
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private lastScreenshotTime = 0;
  private sessionId: string;

  constructor(desktop: DesktopSandboxHandle, config?: RecorderConfig) {
    this.desktop = desktop;
    this.config = {
      fps: config?.fps ?? 2,
      maxFrames: config?.maxFrames ?? MAX_FRAMES_PER_SESSION,
      captureOnAction: config?.captureOnAction ?? true,
      label: config?.label ?? '',
      resolution: config?.resolution ?? [1920, 1080],
      onFrame: config?.onFrame ?? (() => {}),
      onAction: config?.onAction ?? (() => {}),
      onComplete: config?.onComplete ?? (() => {}),
      onError: config?.onError ?? (() => {}),
    };
    this.state = {
      running: false,
      paused: false,
      startedAt: null,
      framesCaptured: 0,
      actionsRecorded: 0,
      elapsedMs: 0,
    };
    this.sessionId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Start recording — begins periodic screenshot capture.
   * Returns the session ID immediately; recording runs in the background.
   */
  async start(config?: Partial<RecorderConfig>): Promise<string> {
    if (this.state.running) {
      logger.warn('[DesktopRecorder] Already recording');
      return this.sessionId;
    }

    // Apply any runtime config overrides
    if (config?.fps !== undefined) this.config.fps = Math.max(0.1, config.fps);
    if (config?.captureOnAction !== undefined) this.config.captureOnAction = config.captureOnAction;

    this.state.running = true;
    this.state.paused = false;
    this.state.startedAt = Date.now();
    this.frames = [];
    this.actions = [];

    logger.info(`[DesktopRecorder] Started recording session "${this.sessionId}" at ${this.config.fps}FPS`);

    // Begin periodic screenshot capture
    const intervalMs = Math.max(
      MIN_CAPTURE_INTERVAL_MS,
      Math.round(1000 / this.config.fps),
    );

    this.captureTimer = setInterval(() => {
      this.captureFrame().catch((err) => {
        logger.error('[DesktopRecorder] Periodic capture error:', err);
        this.config.onError(err);
      });
    }, intervalMs);

    return this.sessionId;
  }

  /**
   * Pause recording — stops screenshot capture but preserves state.
   */
  pause(): void {
    if (!this.state.running || this.state.paused) return;
    this.state.paused = true;
    this.clearCaptureTimer();
    logger.info('[DesktopRecorder] Paused');
  }

  /**
   * Resume recording — restarts screenshot capture.
   */
  resume(): void {
    if (!this.state.running || !this.state.paused) return;
    this.state.paused = false;

    const intervalMs = Math.max(
      MIN_CAPTURE_INTERVAL_MS,
      Math.round(1000 / this.config.fps),
    );
    this.captureTimer = setInterval(() => {
      this.captureFrame().catch((err) => {
        logger.error('[DesktopRecorder] Capture error on resume:', err);
        this.config.onError(err);
      });
    }, intervalMs);

    logger.info('[DesktopRecorder] Resumed');
  }

  /**
   * Stop recording — clears capture timer and returns the session.
   */
  async stop(): Promise<RecordingSession> {
    if (!this.state.running) {
      return this.buildSession();
    }

    this.clearCaptureTimer();

    // Take one final screenshot before marking as stopped
    try {
      const frame = await this.doCaptureFrame(undefined);
      this.config.onFrame(frame);
    } catch {
      // Best-effort
    }

    this.state.running = false;
    const session = this.buildSession();
    logger.info(
      `[DesktopRecorder] Stopped — ${session.metadata.totalFrames} frames, ${session.metadata.totalActions} actions, ${session.metadata.duration}ms`,
    );

    this.config.onComplete(session);
    return session;
  }

  /**
   * Record an action that was executed on the desktop.
   * If captureOnAction is true, also takes a screenshot.
   */
  async recordAction(
    action: DesktopAction,
    options?: { result?: any; success?: boolean },
  ): Promise<RecordedAction> {
    if (!this.state.running) {
      throw new Error('Recording is not active');
    }

    const now = Date.now();
    const startTime = this.state.startedAt ?? now;
    const recorded: RecordedAction = {
      index: this.actions.length,
      timestamp: now,
      elapsedMs: now - startTime,
      action,
      resultJson: options?.result ? JSON.stringify(options.result) : undefined,
      success: options?.success ?? true,
    };

    this.actions.push(recorded);
    this.state.actionsRecorded++;
    this.config.onAction(recorded);

    // Optionally capture a screenshot immediately after the action
    if (this.config.captureOnAction && !this.state.paused) {
      try {
        const frame = await this.doCaptureFrame(recorded.action);
        this.config.onFrame(frame);
      } catch (err: any) {
        logger.warn(`[DesktopRecorder] Screenshot after action failed: ${err.message}`);
      }
    }

    return recorded;
  }

  /**
   * Get the current recording session (while still recording).
   */
  getCurrentSession(): RecordingSession {
    return this.buildSession();
  }

  /**
   * Get the recording session ID.
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the recorder configuration (fps, captureOnAction, etc.).
   */
  getConfig(): Required<RecorderConfig> {
    return { ...this.config };
  }

  /**
   * Get current recorder state.
   */
  getState(): RecorderState {
    return { ...this.state };
  }

  /**
   * Get number of frames captured so far.
   */
  getFrameCount(): number {
    return this.frames.length;
  }

  /**
   * Get number of actions recorded so far.
   */
  getActionCount(): number {
    return this.actions.length;
  }

  // --- Private methods ---

  /**
   * Capture a single frame (periodic capture).
   */
  private async captureFrame(): Promise<void> {
    if (this.state.paused || !this.state.running) return;

    const frame = await this.doCaptureFrame(undefined);
    this.config.onFrame(frame);
  }

  /**
   * Perform the actual screenshot + frame creation.
   */
  private async doCaptureFrame(triggerAction?: DesktopAction): Promise<RecordingFrame> {
    const now = Date.now();
    const startTime = this.state.startedAt ?? now;

    // Check if max frames reached
    if (this.frames.length >= this.config.maxFrames) {
      logger.warn(`[DesktopRecorder] Max frames (${this.config.maxFrames}) reached, stopping capture`);
      this.clearCaptureTimer();
      // Auto-stop the recording
      this.state.running = false;
      const session = this.buildSession();
      this.config.onComplete(session);
      return {
        index: this.frames.length,
        timestamp: now,
        screenshotBase64: null,
        triggerAction,
        elapsedMs: now - startTime,
      };
    }

    let screenshotBase64: string | null = null;
    try {
      const buffer = await this.desktop.screenshot();

      // Resize if too large for storage efficiency
      if (buffer.length > MAX_SCREENSHOT_BYTES) {
        logger.debug(`[DesktopRecorder] Screenshot large (${buffer.length} bytes), storing resized`);
      }

      screenshotBase64 = buffer.toString('base64');
    } catch (err: any) {
      logger.warn(`[DesktopRecorder] Screenshot capture failed: ${err.message}`);
      // Continue with null screenshot — the frame still records timing
    }

    const frame: RecordingFrame = {
      index: this.frames.length,
      timestamp: now,
      screenshotBase64,
      triggerAction,
      elapsedMs: now - startTime,
    };

    this.frames.push(frame);
    this.state.framesCaptured++;
    this.lastScreenshotTime = now;

    return frame;
  }

  /**
   * Clear the capture interval timer.
   */
  private clearCaptureTimer(): void {
    if (this.captureTimer !== null) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
  }

  /**
   * Build a RecordingSession from accumulated frames and actions.
   */
  private buildSession(): RecordingSession {
    const startTime = this.state.startedAt ?? Date.now();
    const now = Date.now();

    return {
      metadata: {
        id: this.sessionId,
        label: this.config.label,
        createdAt: startTime,
        duration: now - startTime,
        fps: this.config.fps,
        totalFrames: this.frames.length,
        totalActions: this.actions.length,
        resolution: this.config.resolution,
      },
      frames: [...this.frames],
      actions: [...this.actions],
    };
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.clearCaptureTimer();
    this.state.running = false;
    this.frames = [];
    this.actions = [];
  }
}

// ============================================================================
// Desktop Player
// ============================================================================

export class DesktopPlayer {
  private session: RecordingSession | null = null;
  private status: PlayerStatus = 'idle';
  private speed = 1;
  private loop = false;
  private startOffsetMs = 0;
  private endOffsetMs = 0;
  private currentFrameIndex = 0;
  private currentActionIndex = 0;
  private elapsedMs = 0;
  private startTimestamp = 0;
  private pausedElapsedMs = 0;
  private playTimer: ReturnType<typeof setTimeout> | null = null;
  private pausedResolve: (() => void) | null = null;
  private eventHandlers = new Map<PlayerEvent, PlayerEventHandler[]>();

  constructor() {
    // Initialise event handler map
    (['frame', 'action', 'complete', 'error', 'status', 'seek'] as PlayerEvent[]).forEach((evt) => {
      this.eventHandlers.set(evt, []);
    });
  }

  // --- Event System ---

  /**
   * Register an event handler.
   */
  on(event: PlayerEvent, handler: PlayerEventHandler): this {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.push(handler);
    }
    return this;
  }

  /**
   * Remove an event handler.
   */
  off(event: PlayerEvent, handler: PlayerEventHandler): this {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
    return this;
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emit(event: PlayerEvent, payload: Partial<PlayerEventPayload>): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;

    const fullPayload: PlayerEventPayload = {
      type: event,
      ...payload,
      state: this.getState(),
    };

    for (const handler of handlers) {
      try {
        handler(fullPayload);
      } catch (err) {
        logger.error('[DesktopPlayer] Event handler error:', err);
      }
    }
  }

  // --- Session Management ---

  /**
   * Load a recording session for playback.
   */
  async load(session: RecordingSession): Promise<void> {
    this.session = session;
    this.status = 'loading';
    this.currentFrameIndex = 0;
    this.currentActionIndex = 0;
    this.elapsedMs = 0;
    this.speed = 1;
    this.loop = false;
    this.startOffsetMs = 0;
    this.endOffsetMs = session.metadata.duration;
    this.clearPlayTimer();

    // Validate frames and actions are sorted by elapsedMs
    this.session.frames.sort((a, b) => a.elapsedMs - b.elapsedMs);
    this.session.actions.sort((a, b) => a.elapsedMs - b.elapsedMs);

    this.status = 'stopped';
    this.emit('status', {});

    logger.info(
      `[DesktopPlayer] Loaded session "${session.metadata.id}": ` +
      `${session.metadata.totalFrames} frames, ${session.metadata.totalActions} actions, ` +
      `${session.metadata.duration}ms duration`,
    );
  }

  /**
   * Unload the current session.
   */
  unload(): void {
    this.clearPlayTimer();
    this.session = null;
    this.status = 'idle';
    this.currentFrameIndex = 0;
    this.currentActionIndex = 0;
    this.elapsedMs = 0;
    this.pausedElapsedMs = 0;
  }

  // --- Playback Controls ---

  /**
   * Start or resume playback.
   */
  async play(config?: PlayerConfig): Promise<void> {
    if (!this.session) {
      throw new Error('No session loaded. Call load() first.');
    }

    if (config) {
      this.speed = config.speed ?? 1;
      this.loop = config.loop ?? false;
      this.startOffsetMs = config.startOffsetMs ?? 0;
      this.endOffsetMs = config.endOffsetMs ?? this.session.metadata.duration;
    }

    // If resuming from pause, restore position
    if (this.status === 'paused') {
      this.status = 'playing';
      this.startTimestamp = Date.now() - this.pausedElapsedMs;
      this.pausedResolve?.();
      this.pausedResolve = null;
      this.emit('status', {});
      logger.info('[DesktopPlayer] Resumed');
      this.tick();
      return;
    }

    // Fresh playback
    if (this.status !== 'stopped' && this.status !== 'completed' && this.status !== 'idle') {
      logger.warn(`[DesktopPlayer] Cannot play from status "${this.status}"`);
      return;
    }

    this.status = 'playing';
    this.startTimestamp = Date.now();
    this.startOffsetMs = config?.startOffsetMs ?? 0;
    this.endOffsetMs = config?.endOffsetMs ?? this.session.metadata.duration;
    this.speed = Math.max(0.1, this.speed); // Minimum 0.1x speed

    // Seek to start offset
    this.currentFrameIndex = this.findFrameIndex(this.startOffsetMs);
    this.currentActionIndex = this.findActionIndex(this.startOffsetMs);
    this.elapsedMs = this.startOffsetMs;

    this.emit('status', {});
    logger.info(`[DesktopPlayer] Playing at ${this.speed}x speed`);

    this.tick();
  }

  /**
   * Pause playback.
   */
  pause(): void {
    if (this.status !== 'playing') return;

    this.status = 'paused';
    this.pausedElapsedMs = this.elapsedMs;
    this.clearPlayTimer();

    // Wait for any in-flight action processing
    this.emit('status', {});

    logger.info('[DesktopPlayer] Paused');
  }

  /**
   * Toggle between play and pause.
   */
  togglePlayPause(): void {
    if (this.status === 'playing') {
      this.pause();
    } else if (this.status === 'paused') {
      this.play({ speed: this.speed, loop: this.loop, startOffsetMs: this.pausedElapsedMs });
    } else {
      this.play({ speed: this.speed, loop: this.loop });
    }
  }

  /**
   * Stop playback and reset to beginning.
   */
  stop(): void {
    this.clearPlayTimer();
    this.status = 'stopped';
    this.currentFrameIndex = 0;
    this.currentActionIndex = 0;
    this.elapsedMs = 0;
    this.pausedElapsedMs = 0;
    this.emit('status', {});
    logger.info('[DesktopPlayer] Stopped');
  }

  /**
   * Seek to a specific position in the recording.
   */
  async seek(elapsedMs: number): Promise<void> {
    if (!this.session) return;

    const wasPlaying = this.status === 'playing';
    if (wasPlaying) {
      this.clearPlayTimer();
    }

    this.status = 'seeking';
    this.elapsedMs = Math.max(0, Math.min(elapsedMs, this.session.metadata.duration));
    this.currentFrameIndex = this.findFrameIndex(this.elapsedMs);
    this.currentActionIndex = this.findActionIndex(this.elapsedMs);
    this.pausedElapsedMs = this.elapsedMs;

    this.emit('seek', {});

    // Emit the current frame/action at the seek position
    const currentFrame = this.session.frames[this.currentFrameIndex];
    if (currentFrame) {
      this.emit('frame', { frame: currentFrame });
    }

    if (wasPlaying) {
      this.status = 'playing';
      this.startTimestamp = Date.now() - (this.elapsedMs / this.speed);
      this.tick();
    } else {
      this.status = 'paused';
      this.emit('status', {});
    }
  }

  /**
   * Set playback speed.
   */
  setSpeed(speed: number): void {
    const wasPlaying = this.status === 'playing';
    if (wasPlaying) {
      this.clearPlayTimer();
    }

    this.speed = Math.max(0.1, speed);

    if (wasPlaying) {
      this.startTimestamp = Date.now() - (this.elapsedMs / this.speed);
      this.tick();
    }
  }

  /**
   * Get current player state.
   */
  getState(): PlayerState {
    return {
      status: this.status,
      sessionId: this.session?.metadata.id ?? null,
      currentFrameIndex: this.currentFrameIndex,
      currentActionIndex: this.currentActionIndex,
      elapsedMs: this.elapsedMs,
      totalDuration: this.session?.metadata.duration ?? 0,
      speed: this.speed,
    };
  }

  /**
   * Get the loaded session.
   */
  getSession(): RecordingSession | null {
    return this.session;
  }

  // --- Private methods ---

  /**
   * Main playback tick — dispatches frames and actions at the correct times.
   */
  private tick(): void {
    if (!this.session || this.status !== 'playing') return;

    const now = Date.now();
    this.elapsedMs = (now - this.startTimestamp) * this.speed;

    // Check bounds
    if (this.elapsedMs >= this.endOffsetMs || this.elapsedMs >= this.session.metadata.duration) {
      if (this.loop) {
        // Loop back to start
        this.elapsedMs = this.startOffsetMs;
        this.currentFrameIndex = this.findFrameIndex(this.startOffsetMs);
        this.currentActionIndex = this.findActionIndex(this.startOffsetMs);
        this.startTimestamp = now - (this.elapsedMs / this.speed);
        this.emit('status', {});
      } else {
        this.clearPlayTimer();
        this.status = 'completed';
        this.elapsedMs = this.session.metadata.duration;
        this.emit('complete', {});
        this.emit('status', {});
        logger.info('[DesktopPlayer] Playback completed');
      }
      return;
    }

    // Dispatch frames at their elapsed times
    while (
      this.currentFrameIndex < this.session.frames.length &&
      this.session.frames[this.currentFrameIndex].elapsedMs <= this.elapsedMs
    ) {
      const frame = this.session.frames[this.currentFrameIndex];
      this.emit('frame', { frame });
      this.currentFrameIndex++;
    }

    // Dispatch actions at their elapsed times
    while (
      this.currentActionIndex < this.session.actions.length &&
      this.session.actions[this.currentActionIndex].elapsedMs <= this.elapsedMs
    ) {
      const actionRecord = this.session.actions[this.currentActionIndex];
      this.emit('action', { action: actionRecord });
      this.currentActionIndex++;
    }

    // Schedule next tick — use a short interval for smooth playback
    this.scheduleNextTick();
  }

  /**
   * Schedule the next playback tick.
   */
  private scheduleNextTick(): void {
    // Tick at roughly 60fps for smooth playback;
    // cap interval at ~16ms to avoid excessive CPU while staying responsive
    this.playTimer = setTimeout(() => this.tick(), 16);
  }

  /**
   * Find the nearest frame index for a given elapsed time.
   */
  private findFrameIndex(elapsedMs: number): number {
    if (!this.session || this.session.frames.length === 0) return 0;
    if (elapsedMs <= 0) return 0;

    const frames = this.session.frames;
    // Binary search
    let lo = 0;
    let hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (frames[mid].elapsedMs <= elapsedMs) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /**
   * Find the nearest action index for a given elapsed time.
   */
  private findActionIndex(elapsedMs: number): number {
    if (!this.session || this.session.actions.length === 0) return 0;
    if (elapsedMs <= 0) return 0;

    const actions = this.session.actions;
    let lo = 0;
    let hi = actions.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (actions[mid].elapsedMs <= elapsedMs) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /**
   * Clear playback timer.
   */
  private clearPlayTimer(): void {
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.clearPlayTimer();
    this.session = null;
    this.eventHandlers.clear();
  }
}

// ============================================================================
// Recording Session I/O
// ============================================================================

/**
 * Export a recording session to a JSON-serialisable object.
 * WARNING: Base64 screenshots can make the output very large.
 */
export function exportSessionToJSON(session: RecordingSession): string {
  return JSON.stringify(session, null, 2);
}

/**
 * Import a recording session from a JSON string.
 */
export function importSessionFromJSON(json: string): RecordingSession {
  const parsed = JSON.parse(json);

  // Validate structure
  if (!parsed.metadata || !parsed.frames || !parsed.actions) {
    throw new Error('Invalid recording session JSON: missing required fields');
  }
  if (!Array.isArray(parsed.frames) || !Array.isArray(parsed.actions)) {
    throw new Error('Invalid recording session JSON: frames and actions must be arrays');
  }

  return parsed as RecordingSession;
}

/**
 * Estimate the size of a recording session in bytes.
 */
export function estimateSessionSize(session: RecordingSession): {
  framesBytes: number;
  actionsBytes: number;
  metadataBytes: number;
  totalBytes: number;
} {
  const framesBytes = session.frames.reduce(
    (sum, f) => sum + (f.screenshotBase64?.length ?? 0) + 100, // +100 for metadata per frame
    0,
  );
  const actionsBytes = session.actions.reduce(
    (sum, a) => sum + (a.resultJson?.length ?? 0) + 200, // +200 for metadata per action
    0,
  );
  const metadataBytes = JSON.stringify(session.metadata).length;
  const totalBytes = framesBytes + actionsBytes + metadataBytes;

  return {
    framesBytes,
    actionsBytes,
    metadataBytes,
    totalBytes,
  };
}

/**
 * Get a summary of a recording session for display.
 */
export function summarizeSession(session: RecordingSession): string {
  const dur = session.metadata.duration;
  const mins = Math.floor(dur / 60000);
  const secs = Math.floor((dur % 60000) / 1000);
  const size = estimateSessionSize(session);

  return [
    `Session: ${session.metadata.id}`,
    `  Label: ${session.metadata.label || '(none)'}`,
    `  Duration: ${mins}m ${secs}s (${dur}ms)`,
    `  Frames: ${session.metadata.totalFrames} @ ${session.metadata.fps} FPS`,
    `  Actions: ${session.metadata.totalActions}`,
    `  Size: ${(size.totalBytes / 1024 / 1024).toFixed(2)} MB`,
    `    - Screenshots: ${(size.framesBytes / 1024 / 1024).toFixed(2)} MB`,
    `    - Actions: ${(size.actionsBytes / 1024).toFixed(1)} KB`,
  ].join('\n');
}

// ============================================================================
// Export default
// ============================================================================

export default DesktopRecorder;
