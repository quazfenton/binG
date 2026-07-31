/**
 * Stream chunk handler — extracted from the chat route's per-iteration
 * `config.onStreamChunk` callback so it can be unit-tested in isolation and
 * reused by the separate streaming path (unifiedResponse.stream generator).
 *
 * The handler:
 *  - Appends each chunk to `state.buffer`
 *  - Suppresses token emissions after a marker in `markers` is seen (so the
 *    user never sees raw `[ROLE_SELECT]` / `[ROUTING_METADATA]` JSON)
 *  - Extracts incremental file edits via `extractIncrementalFileEdits` and
 *    emits `SSE_EVENT_TYPES.FILE_EDIT` events for each detected edit
 */

import { createSSEEmitter, SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import {
  createIncrementalParser,
  extractIncrementalFileEdits,
  isValidFilePath,
} from '@/lib/chat/file-edit-parser';

/**
 * Wrapped in an object so the factory captures state by reference across
 * iterations — the loop mutates the fields in place at the start of each
 * iteration rather than re-wiring the handler.
 */
export interface StreamChunkState {
  buffer: string;
  parser: ReturnType<typeof createIncrementalParser>;
  markerSeen: boolean;
  charsEmittedSafely: number;
  /** Bug #16 (audit): Accumulated reasoning/thinking tokens from the stream.
   *  Emitted in the final DONE event so client consumers can access the full
   *  reasoning trace after the stream closes. Non-reasoning models will leave
   *  this undefined. */
  reasoningContent?: string;
}

/** Default markers used by the chat route to suppress routing JSON. */
export const DEFAULT_ROLE_SELECT_MARKERS: readonly string[] = [
  '[ROLE_SELECT]',
  '[ROUTING_METADATA]',
];

/**
 * Factory that builds a per-iteration `config.onStreamChunk` handler.
 *
 * @param state - mutable per-iteration state (see `StreamChunkState`). The
 *   caller is responsible for resetting its fields at the start of each loop
 *   iteration so the handler starts clean.
 * @param emit - the SSE emitter returned by `createSSEEmitter(controller)`.
 * @param markers - the routing markers whose first occurrence suppresses
 *   further token emissions. Defaults to `DEFAULT_ROLE_SELECT_MARKERS`.
 * @param holdback - number of trailing chars to withhold from emission when
 *   no marker has been seen yet, so a marker straddling a chunk boundary is
 *   never partially emitted. Defaults to the longest marker length
 *   (`Math.max(...markers.map(m => m.length))`), which is the safest value.
 *   Callers can override (e.g. `holdback: 16`) to match a previously-tuned
 *   behavior.
 */
export function createStreamChunkHandler(
  state: StreamChunkState,
  emit: ReturnType<typeof createSSEEmitter>,
  markers: readonly string[] = DEFAULT_ROLE_SELECT_MARKERS,
  holdback: number = Math.max(...markers.map((m) => m.length)),
  /**
   * Optional callback fired exactly once per handler lifetime, on the
   * false→true transition of `state.markerSeen`. Use this to add per-path
   * observability (e.g. debug logs) without wrapping the returned handler
   * in a per-chunk closure.
   */
  onMarkerSeen?: (info: { bufferLength: number; marker: string }) => void
): (chunk: string) => void {
  return (chunk: string) => {
    state.buffer += chunk;

    if (!state.markerSeen) {
      let markerIdx = -1;
      let matchedMarker: string | null = null;
      for (const m of markers) {
        const idx = state.buffer.indexOf(m);
        if (idx !== -1 && (markerIdx === -1 || idx < markerIdx)) {
          markerIdx = idx;
          matchedMarker = m;
        }
      }
      if (markerIdx !== -1 && matchedMarker !== null) {
        if (markerIdx > state.charsEmittedSafely) {
          const safe = state.buffer.slice(state.charsEmittedSafely, markerIdx);
          if (safe) emit(SSE_EVENT_TYPES.TOKEN, { content: safe, timestamp: Date.now() });
        }
        state.charsEmittedSafely = state.buffer.length;
        const wasMarkerSeen = state.markerSeen;
        state.markerSeen = true;
        if (!wasMarkerSeen) {
          onMarkerSeen?.({ bufferLength: state.buffer.length, marker: matchedMarker });
        }
      } else {
        const safeUpto = Math.max(state.charsEmittedSafely, state.buffer.length - holdback);
        if (safeUpto > state.charsEmittedSafely) {
          const safe = state.buffer.slice(state.charsEmittedSafely, safeUpto);
          if (safe) emit(SSE_EVENT_TYPES.TOKEN, { content: safe, timestamp: Date.now() });
          state.charsEmittedSafely = safeUpto;
        }
      }
    }

    const newFileEdits = extractIncrementalFileEdits(state.buffer, state.parser);
    if (newFileEdits && newFileEdits.length > 0) {
      for (const edit of newFileEdits) {
        if (!isValidFilePath(edit.path)) continue;
        const editContent = edit.content || edit.diff || '';
        if (!editContent || editContent.trim().length === 0) continue;
        const isPatch = edit.action === 'patch' || !!edit.diff;
        emit(SSE_EVENT_TYPES.FILE_EDIT, {
          path: edit.path,
          status: 'detected',
          operation: isPatch ? 'patch' : 'write',
          timestamp: Date.now(),
          content: edit.content || '',
          diff: isPatch ? (edit.diff || '') : undefined,
        });
      }
    }
  };
}

/** Create a fresh per-iteration state object with empty buffer and parser. */
export function createStreamChunkState(): StreamChunkState {
  return {
    buffer: '',
    parser: createIncrementalParser(),
    markerSeen: false,
    charsEmittedSafely: 0,
  };
}

/** Reset an existing state object in place (used at the start of each loop iteration). */
export function resetStreamChunkState(state: StreamChunkState): void {
  state.buffer = '';
  state.parser = createIncrementalParser();
  state.markerSeen = false;
  state.charsEmittedSafely = 0;
}
