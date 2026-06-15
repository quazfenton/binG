/**
 * Unit tests for `createStreamChunkHandler` — extracted from the chat route's
 * per-iteration `config.onStreamChunk` callback. Covers:
 *  1. Marker detection (suppresses token emissions after marker is seen)
 *  2. Holdback flushing (emits safe prefix, withholds trailing chars that
 *     could be the start of a marker)
 *  3. File edit extraction (emits SSE FILE_EDIT events for detected edits)
 *  4. Per-iteration reset (state can be reset and reused cleanly)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSE_EVENT_TYPES } from '@/lib/streaming/sse-event-schema';
import { extractIncrementalFileEdits } from '@/lib/chat/file-edit-parser';
import {
  createStreamChunkHandler,
  createStreamChunkState,
  resetStreamChunkState,
  DEFAULT_ROLE_SELECT_MARKERS,
  type StreamChunkState,
} from '@/lib/chat/stream-chunk-handler';

// Mock file-edit-parser so we can control what extractIncrementalFileEdits
// returns for the patch-branch test. The default calls through to the real
// implementation so other tests exercise real parser→handler integration.
// Only the patch test uses mockReturnValueOnce to override with a synthetic
// edit that has a diff field (the real parser doesn't produce diff edits).
vi.mock('@/lib/chat/file-edit-parser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/file-edit-parser')>(
    '@/lib/chat/file-edit-parser'
  );
  return {
    ...actual,
    extractIncrementalFileEdits: vi.fn(
      (buffer: string, parser: unknown) => actual.extractIncrementalFileEdits(buffer, parser as Parameters<typeof actual.extractIncrementalFileEdits>[1])
    ),
  };
});

/** Spy that captures every emit(type, data) call. */
function makeEmitSpy() {
  return vi.fn();
}

/** Filter emit calls by SSE event type. */
function emitsOfType(emit: ReturnType<typeof makeEmitSpy>, type: string) {
  return emit.mock.calls.filter(([t]) => t === type);
}

/** Long safe-content string that exceeds the 17-char holdback for [ROUTING_METADATA]. */
const LONG_SAFE = 'this is a long safe content string that exceeds the holdback window';

describe('createStreamChunkHandler', () => {
  let state: StreamChunkState;
  let emit: ReturnType<typeof makeEmitSpy>;

  beforeEach(() => {
    state = createStreamChunkState();
    emit = makeEmitSpy();
  });

  // ─────────────────────────────────────────────────────────────────────
  // 1. Marker detection
  // ─────────────────────────────────────────────────────────────────────
  describe('marker detection', () => {
    it('emits TOKEN for content before the marker, then suppresses everything after', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Stream: "hello [ROLE_SELECT] routing-payload"
      handler('hello ');
      handler('[ROLE_SELECT]');
      handler(' routing-payload');
      handler(' more content');

      // Only one TOKEN emit: "hello " (the safe prefix before the marker)
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('hello ');

      // Buffer retains everything (marker + suppressed content) for parsing
      expect(state.buffer).toContain('[ROLE_SELECT]');
      expect(state.buffer).toContain('routing-payload');
      expect(state.markerSeen).toBe(true);
    });

    it('emits nothing if the stream starts with a marker', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      handler('[ROLE_SELECT]');
      handler('anything after');

      expect(emit).not.toHaveBeenCalled();
      expect(state.markerSeen).toBe(true);
    });

    it('picks the earliest marker when multiple markers are present', () => {
      const handler = createStreamChunkHandler(state, emit, ['[A]', '[B]']);

      handler('before-A [A] middle [B] after');
      // Only the prefix before [A] is emitted; [B] is ignored
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('before-A ');
      expect(state.markerSeen).toBe(true);
    });

    it('supports custom markers (e.g. for tests)', () => {
      const handler = createStreamChunkHandler(state, emit, ['<<<END>>>']);

      handler('safe content <<<END>>> secret');
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('safe content ');
      expect(state.markerSeen).toBe(true);
    });

    it('detects a marker split across two chunks (holdback prevents partial emit)', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Stream a long safe prefix, then split the marker across two chunks.
      // The holdback must prevent any emit from containing the marker text
      // (even if the marker straddles a chunk boundary).
      handler(LONG_SAFE);
      handler('[ROLE_SELE');
      // Complete the marker
      handler('CT] secret-after');
      const allEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      // The marker should be detected and subsequent emissions suppressed
      expect(state.markerSeen).toBe(true);
      // No emit should ever contain the marker text itself
      const allEmittedContent = allEmits.map(([, d]) => d.content).join('');
      expect(allEmittedContent).not.toContain('[ROLE_SELECT]');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2. Holdback flushing
  // ─────────────────────────────────────────────────────────────────────
  describe('holdback flushing', () => {
    it('withholds trailing chars that could be the start of a marker', () => {
      // "[ROUTING_METADATA]" is 17 chars — the handler must hold back 17 chars
      // at the end of the buffer so a marker straddling a chunk boundary
      // is never partially emitted.
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);
      const HOLDBACK = Math.max(...DEFAULT_ROLE_SELECT_MARKERS.map((m) => m.length));

      // Stream 30 chars of safe content in one chunk
      handler('a'.repeat(30));

      // Only (30 - 17) = 13 chars should be emitted
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('a'.repeat(30 - HOLDBACK));
      expect(state.charsEmittedSafely).toBe(30 - HOLDBACK);
    });

    it('flushed content is not re-emitted on subsequent chunks', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      handler(LONG_SAFE);
      // Some content emitted (minus holdback)
      const firstEmit = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(firstEmit).toHaveLength(1);
      const firstEmitLen = firstEmit[0][1].content.length;
      expect(state.charsEmittedSafely).toBe(firstEmitLen);

      // More safe content — only the NEW chars are emitted
      emit.mockClear();
      handler(' more');
      const secondEmit = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      // The holdback window may have moved, but the second emit must not
      // overlap with the first emit (i.e., must start at or after firstEmitLen)
      expect(secondEmit.length).toBeGreaterThan(0);
      const secondEmitStart = state.buffer.indexOf(secondEmit[0][1].content);
      expect(secondEmitStart).toBeGreaterThanOrEqual(firstEmitLen);
    });

    it('emits withheld prefix when a marker is found mid-buffer', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      handler(LONG_SAFE);
      const before = state.charsEmittedSafely;
      expect(before).toBeGreaterThan(0);
      expect(before).toBeLessThan(state.buffer.length);

      // Marker arrives — emits any withheld chars up to the marker
      emit.mockClear();
      handler('[ROLE_SELECT]');
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      // Should emit withheld content between charsEmittedSafely and the marker
      expect(tokenEmits.length).toBeGreaterThan(0);
      expect(tokenEmits[0][1].content.length).toBeGreaterThan(0);
      expect(state.markerSeen).toBe(true);
      expect(state.charsEmittedSafely).toBe(state.buffer.length);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 3. File edit extraction
  // ─────────────────────────────────────────────────────────────────────
  describe('file edit extraction', () => {
    it('emits FILE_EDIT for a complete fenced code block', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Stream a complete file write fenced block
      handler('```typescript\n// src/hello.ts\nconsole.log("hi");\n```');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      expect(fileEdits).toHaveLength(1);
      const edit = fileEdits[0][1];
      expect(edit.path).toContain('hello.ts');
      expect(edit.status).toBe('detected');
      expect(edit.operation).toBe('write');
    });

  // ─────────────────────────────────────────────────────────────────────
  // 5. Holdback parameter
  // ─────────────────────────────────────────────────────────────────────
  describe('holdback parameter', () => {
    it('defaults to the longest marker length (18 for [ROUTING_METADATA])', () => {
      const handler = createStreamChunkHandler(state, emit);
      // 30 chars, default holdback = 18 (max marker length) → 12 chars emitted
      handler('a'.repeat(30));
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('a'.repeat(12));
    });

    it('honors a custom holdback value (e.g. 16 for the second streaming path)', () => {
      const handler = createStreamChunkHandler(
        state,
        emit,
        DEFAULT_ROLE_SELECT_MARKERS,
        16
      );
      // 30 chars, custom holdback = 16 → 14 chars emitted
      handler('a'.repeat(30));
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('a'.repeat(14));
    });

    it('still detects a marker correctly with a custom holdback', () => {
      const handler = createStreamChunkHandler(
        state,
        emit,
        DEFAULT_ROLE_SELECT_MARKERS,
        16
      );
      handler('safe content ');
      handler('[ROLE_SELECT]');
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits).toHaveLength(1);
      expect(tokenEmits[0][1].content).toBe('safe content ');
      expect(state.markerSeen).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 6. File edit extraction (continued from line ~256 before refactor)
  // ─────────────────────────────────────────────────────────────────────
  describe('file edit extraction', () => {
    it('emits FILE_EDIT for a complete fenced code block', () => {
      // vi.mock above is hoisted before module load, so the handler captures
      // the mocked extractIncrementalFileEdits at import time.
      vi.mocked(extractIncrementalFileEdits).mockReturnValueOnce([
        {
          path: 'src/foo.ts',
          content: 'old content',
          diff: '--- a/foo.ts\n+++ b/foo.ts\n-old\n+new',
          action: 'patch',
        },
      ]);

      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);
      handler('any content — parser is mocked');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      expect(fileEdits).toHaveLength(1);
      expect(fileEdits[0][1].operation).toBe('patch');
      expect(fileEdits[0][1].diff).toBeDefined();
      expect(fileEdits[0][1].path).toBe('src/foo.ts');
    });

    it('skips edits with empty content', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Fenced block with empty content
      handler('```typescript\n// src/empty.ts\n```');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      // No FILE_EDIT should be emitted for empty content
      expect(fileEdits).toHaveLength(0);
    });

    it('skips edits with invalid file paths (path traversal)', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // isValidFilePath rejects paths containing .. traversal
      handler('```typescript\n// ../../etc/passwd\nmalicious content\n```');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      // No FILE_EDIT for invalid paths
      expect(fileEdits).toHaveLength(0);
    });

    it('skips edits with paths containing NUL bytes (definitively invalid)', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // A path with a NUL byte is definitively rejected by isValidFilePath
      // (NUL bytes are never valid in filesystem paths on any platform)
      handler('```typescript\n// src/\0evil.ts\ncontent\n```');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      expect(fileEdits).toHaveLength(0);
    });

    it('emits detected status (not applied) — application happens server-side later', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      handler('```typescript\n// src/foo.ts\nexport const x = 1;\n```');

      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      expect(fileEdits).toHaveLength(1);
      expect(fileEdits[0][1].status).toBe('detected');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // 4. Per-iteration reset
  // ─────────────────────────────────────────────────────────────────────
  describe('per-iteration reset', () => {
    it('resetStreamChunkState clears buffer, parser, markerSeen, and charsEmittedSafely', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Dirty the state
      handler('hello [ROLE_SELECT] world');
      expect(state.buffer).not.toBe('');
      expect(state.markerSeen).toBe(true);
      expect(state.charsEmittedSafely).toBeGreaterThan(0);

      // Reset
      resetStreamChunkState(state);
      expect(state.buffer).toBe('');
      expect(state.markerSeen).toBe(false);
      expect(state.charsEmittedSafely).toBe(0);
      // Parser is a fresh instance
      expect(state.parser).toBeDefined();
    });

    it('same handler works after reset (no re-wiring needed)', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // First iteration: marker is seen
      handler(LONG_SAFE + ' [ROLE_SELECT] suppressed');
      expect(state.markerSeen).toBe(true);

      // Reset and re-use
      resetStreamChunkState(state);
      emit.mockClear();

      // Second iteration: new content, no marker — should emit tokens again
      handler(LONG_SAFE);
      const tokenEmits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(tokenEmits.length).toBeGreaterThan(0);
      expect(tokenEmits[0][1].content).toContain('this is a long');
      expect(state.markerSeen).toBe(false);
    });

    it('two iterations with marker in first, not in second, emit cleanly', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Iteration 1: marker present
      handler(LONG_SAFE + ' [ROLE_SELECT] after');
      const iter1Emits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(iter1Emits).toHaveLength(1);
      // The safe prefix includes everything up to the marker, so it contains
      // LONG_SAFE plus the space before [ROLE_SELECT].
      expect(iter1Emits[0][1].content).toContain(LONG_SAFE);

      // Reset for iteration 2
      resetStreamChunkState(state);
      emit.mockClear();

      // Iteration 2: no marker, long enough to clear holdback
      handler(LONG_SAFE);
      const iter2Emits = emitsOfType(emit, SSE_EVENT_TYPES.TOKEN);
      expect(iter2Emits.length).toBeGreaterThan(0);
      expect(iter2Emits[0][1].content).toContain('this is a long');
    });

    it('createStreamChunkState returns a fresh state object', () => {
      const a = createStreamChunkState();
      const b = createStreamChunkState();
      expect(a).not.toBe(b);
      expect(a.parser).not.toBe(b.parser); // Fresh parser instances
      expect(a.buffer).toBe('');
      expect(b.buffer).toBe('');
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Integration: marker + file edit in the same stream
  // ─────────────────────────────────────────────────────────────────────
  describe('integration: marker + file edit in the same stream', () => {
    it('emits FILE_EDIT for content after a marker (file edits can occur post-routing)', () => {
      const handler = createStreamChunkHandler(state, emit, DEFAULT_ROLE_SELECT_MARKERS);

      // Stream: safe text, marker, then a file edit
      handler('intro text [ROLE_SELECT] routing-json');
      handler(' ```typescript\n// src/post.ts\ncode\n```');

      // File edit should be emitted even though the marker was seen
      const fileEdits = emitsOfType(emit, SSE_EVENT_TYPES.FILE_EDIT);
      expect(fileEdits).toHaveLength(1);
      expect(fileEdits[0][1].path).toContain('post.ts');
    });
  });
});
});
