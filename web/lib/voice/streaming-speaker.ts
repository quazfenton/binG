/**
 * Streaming Speaker v2
 *
 * Index-based prose extraction from streaming LLM responses.
 * Uses detectUnclosedTags from file-edit-parser as "Red Zone" boundary
 * to prevent speaking code blocks or file edits.
 * Uses sanitizeAssistantDisplayContent to strip completed code blocks.
 * Listens to filesystem-updated events as authoritative code-block closure.
 *
 * Signal priority (strict hierarchy):
 *   1. detectUnclosedTags → hard boundary (never speak past it)
 *   2. filesystem-updated  → authoritative closure (resume prose)
 *   3. Sentence boundaries → cadence smoothing (not correctness)
 */

import { voiceService } from './voice-service';
import {
  detectUnclosedTags,
  sanitizeAssistantDisplayContent,
} from '@/lib/chat/file-edit-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trailing chars to hold back from the raw stream to avoid partial words/tags */
const LATENCY_CHARS = 200;

/** Minimum prose length before we send a chunk to TTS */
const MIN_SPEAKABLE_LEN = 40;

/** How far back from the buffer tail to scan for unclosed tags */
const UNCLOSED_SCAN_TAIL = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SpeakState = 'SPEAKING_PROSE' | 'WAITING_FOR_CLOSURE';

// ---------------------------------------------------------------------------
// StreamingSpeaker
// ---------------------------------------------------------------------------

export class StreamingSpeaker {
  private state: SpeakState = 'SPEAKING_PROSE';

  /**
   * Cursor into the *sanitized-prose* string.
   * Everything before this index has already been sent to TTS.
   */
  private lastSpokenIndex = 0;

  /** Last raw content length we evaluated (avoids re-work on identical input) */
  private lastContentLength = 0;

  /** FIFO queue of text chunks waiting to be spoken */
  private speechQueue: string[] = [];

  /** True while we're awaiting voiceService.speak() for the current chunk */
  private isProcessing = false;

  /** If true, all output is suppressed (barge-in) */
  private isPaused = false;

  /** Cleanup handle for the window event listener */
  private eventCleanup: (() => void) | null = null;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  constructor() {
    this.attachWindowListener();
  }

  /**
   * Reset all state. Called at the start of each new LLM response.
   */
  reset() {
    this.state = 'SPEAKING_PROSE';
    this.lastSpokenIndex = 0;
    this.lastContentLength = 0;
    this.speechQueue = [];
    this.isProcessing = false;
    this.isPaused = false;
    // Re-attach listener (idempotent — cleans up first)
    this.attachWindowListener();
  }

  /**
   * Tear down. Called when the component unmounts or the speaker is discarded.
   */
  destroy() {
    this.detachWindowListener();
    this.speechQueue = [];
    this.isPaused = true;
  }

  // -------------------------------------------------------------------------
  // Main feed loop — called on every SSE `token` / `primary_response` event
  // -------------------------------------------------------------------------

  /**
   * Feed the full accumulated content from the stream.
   * This method is *idempotent*: calling it twice with the same content is a no-op.
   *
   * @param fullContent The complete `accumulatedContent` string so far.
   */
  feed(fullContent: string) {
    if (this.isPaused || !fullContent) return;
    if (fullContent.length === this.lastContentLength) return;
    this.lastContentLength = fullContent.length;

    // ── 1. Compute Red Zone ──────────────────────────────────────────────
    // detectUnclosedTags scans the tail of `fullContent` for opening markers
    // (file_edit, file_write, apply_diff, ```, heredoc, etc.) that lack a
    // closing counterpart. Returns absolute positions of those openers.
    const unclosedPositions = detectUnclosedTags(fullContent, 0, UNCLOSED_SCAN_TAIL);
    const redZoneStart =
      unclosedPositions.length > 0
        ? Math.min(...unclosedPositions)
        : Infinity;

    // Update state machine
    if (redZoneStart < Infinity) {
      this.state = 'WAITING_FOR_CLOSURE';
    } else if (this.state === 'WAITING_FOR_CLOSURE') {
      // All previously-unclosed tags have now closed
      this.state = 'SPEAKING_PROSE';
    }

    // ── 2. Compute safe raw boundary ─────────────────────────────────────
    // We hold back LATENCY_CHARS from the live edge to avoid speaking a
    // partial word or the first chars of an opening tag.
    const safeRawIndex = Math.min(
      Math.max(0, fullContent.length - LATENCY_CHARS),
      redZoneStart,
    );
    if (safeRawIndex <= 0) return;

    // ── 3. Sanitize the safe prefix to extract prose ─────────────────────
    // sanitizeAssistantDisplayContent strips completed file-edit tags,
    // thought blocks, heredocs, tool-call XML, code fences, etc.
    // What remains is the prose the user actually sees.
    const rawPrefix = fullContent.slice(0, safeRawIndex);
    const proseOnly = sanitizeAssistantDisplayContent(rawPrefix);

    if (proseOnly.length <= this.lastSpokenIndex) return;

    // ── 4. Extract new prose since last spoken position ──────────────────
    const newProse = proseOnly.slice(this.lastSpokenIndex);
    if (newProse.trim().length < MIN_SPEAKABLE_LEN) return;

    // ── 5. Find the last sentence boundary ──────────────────────────────
    // We only emit up to a complete sentence so the voice sounds natural.
    const sentenceEnd = this.findSentenceBoundary(newProse);
    if (sentenceEnd < MIN_SPEAKABLE_LEN) return;

    // ── 6. Emit ─────────────────────────────────────────────────────────
    const textToSpeak = newProse.slice(0, sentenceEnd).trim();
    if (textToSpeak.length > 0) {
      this.lastSpokenIndex += sentenceEnd;
      this.enqueue(textToSpeak);
    }
  }

  // -------------------------------------------------------------------------
  // Finalization — called when the SSE stream emits `done`
  // -------------------------------------------------------------------------

  /**
   * Finalize with the complete response content.
   * Speaks any remaining trailing prose that was held back by the latency buffer.
   */
  async finalizeWithContent(fullContent: string) {
    if (this.isPaused || !fullContent) return;

    // No latency buffer — stream is complete, everything is safe
    const proseOnly = sanitizeAssistantDisplayContent(fullContent);

    if (proseOnly.length > this.lastSpokenIndex) {
      const remaining = proseOnly.slice(this.lastSpokenIndex).trim();
      if (remaining.length > 10) {
        this.lastSpokenIndex = proseOnly.length;
        this.enqueue(remaining);
      }
    }

    // Wait for the queue to drain
    await this.drainQueue();
  }

  /**
   * Finalize without content (backward-compatible).
   * Waits for any in-flight speech to complete.
   */
  async finalize() {
    if (this.isPaused) return;
    await this.drainQueue();
  }

  // -------------------------------------------------------------------------
  // External signals
  // -------------------------------------------------------------------------

  /**
   * Called when a `filesystem-updated` event confirms a code block was
   * written to disk. This is the strongest "code is done" signal.
   */
  onFilesystemUpdate() {
    if (this.state === 'WAITING_FOR_CLOSURE') {
      this.state = 'SPEAKING_PROSE';
    }
  }

  /**
   * Pause all speech output (e.g., user started speaking — barge-in).
   */
  pause() {
    this.isPaused = true;
    voiceService.stopSpeaking();
    this.speechQueue = [];
  }

  /**
   * Resume speech output after a pause.
   */
  resume() {
    this.isPaused = false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Find the last position in `text` that ends a complete sentence.
   * Returns the index *after* the trailing whitespace so the slice is clean.
   */
  private findSentenceBoundary(text: string): number {
    let lastBoundary = -1;
    // Match sentence-ending punctuation optionally followed by closing
    // quotes/brackets, then whitespace.
    const re = /[.!?]["')\]]*\s/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      lastBoundary = m.index + m[0].length;
    }
    return lastBoundary;
  }

  private enqueue(text: string) {
    this.speechQueue.push(text);
    void this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.isPaused || this.speechQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.speechQueue.length > 0 && !this.isPaused) {
      const text = this.speechQueue.shift();
      if (text) {
        try {
          await voiceService.speak(text);
        } catch (e) {
          console.warn('[StreamingSpeaker] Speech failed:', e);
        }
      }
    }

    this.isProcessing = false;
  }

  private async drainQueue() {
    const maxWait = 60_000; // 60 s safety cap
    const start = Date.now();
    while (
      (this.isProcessing || this.speechQueue.length > 0) &&
      Date.now() - start < maxWait
    ) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // -------------------------------------------------------------------------
  // Window event listener for `filesystem-updated`
  // -------------------------------------------------------------------------

  private attachWindowListener() {
    this.detachWindowListener();
    if (typeof window === 'undefined') return;

    const handler = () => this.onFilesystemUpdate();
    window.addEventListener('filesystem-updated', handler);
    this.eventCleanup = () => {
      window.removeEventListener('filesystem-updated', handler);
    };
  }

  private detachWindowListener() {
    if (this.eventCleanup) {
      this.eventCleanup();
      this.eventCleanup = null;
    }
  }
}

// Singleton
export const streamingSpeaker = new StreamingSpeaker();
