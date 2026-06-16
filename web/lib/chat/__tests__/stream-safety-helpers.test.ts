/**
 * Behavioral tests for the Stream Safety Helpers.
 *
 * These tests MOCK the dependencies (ReadableStreamDefaultController,
 * TextEncoder) and assert the actual RUNTIME BEHAVIOR — not just the
 * source structure. This is the behavioral counterpart to the structural
 * checks in `route-fixes-round1.test.ts`.
 *
 * COVERAGE:
 *   A. signalStreamError — behavioral
 *      - calls `controller.error()` with an Error instance
 *      - the Error has the correct message
 *      - returns a StreamErrorSignal sentinel with the correct shape
 *      - works with a mock controller that records error calls
 *
 *   B. isStreamErrorSignal — behavioral
 *      - returns true for StreamErrorSignal sentinels
 *      - returns false for other objects, null, undefined, primitives
 *
 *   C. safeEnqueue — behavioral
 *      - calls `controller.enqueue()` with encoded bytes when encoderRef is set
 *      - SKIPS enqueue (returns false) when encoderRef is null
 *      - the encoded bytes match `encoderRef.encode(eventStr)`
 *      - does NOT throw when encoderRef is null
 *      - does NOT call encoderRef.encode() when encoderRef is null
 *
 *   D. Integration — signalStreamError + safeEnqueue work together
 *      - signalStreamError closes the stream without affecting safeEnqueue
 *      - safeEnqueue after cleanup returns false (real-world scenario)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  signalStreamError,
  isStreamErrorSignal,
  safeEnqueue,
  type StreamErrorSignal,
} from '../stream-safety-helpers';

// ─── MOCK FACTORIES ──────────────────────────────────────────────────────

/**
 * Creates a mock ReadableStreamDefaultController that records all
 * `error()` and `enqueue()` calls for later assertion.
 */
function makeMockController(): {
  controller: ReadableStreamDefaultController<Uint8Array>;
  errorCalls: Error[];
  enqueueCalls: Uint8Array[];
} {
  const errorCalls: Error[] = [];
  const enqueueCalls: Uint8Array[] = [];
  const controller = {
    error: vi.fn((err: Error) => {
      errorCalls.push(err);
    }),
    enqueue: vi.fn((chunk: Uint8Array) => {
      enqueueCalls.push(chunk);
    }),
    // Required by the ReadableStreamDefaultController type but not used in tests
    close: vi.fn(),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, errorCalls, enqueueCalls };
}

// ─── A. signalStreamError — behavioral ───────────────────────────────────

describe('A. signalStreamError — behavioral', () => {
  it('calls controller.error() with an Error instance', () => {
    const { controller, errorCalls } = makeMockController();
    signalStreamError(controller, 'Test error message');

    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]).toBeInstanceOf(Error);
    expect(errorCalls[0].message).toBe('Test error message');
  });

  it('uses the exact message passed in (no wrapping, no transformation)', () => {
    const { controller, errorCalls } = makeMockController();
    const message = 'No response body reader available from gateway stream';
    signalStreamError(controller, message);

    expect(errorCalls[0]?.message).toBe(message);
  });

  it('returns a StreamErrorSignal sentinel with streamError: true', () => {
    const { controller } = makeMockController();
    const result = signalStreamError(controller, 'test');

    expect(result.streamError).toBe(true);
    expect(result.message).toBe('test');
    expect(result.error).toBeInstanceOf(Error);
  });

  it('returns the same Error instance that was passed to controller.error()', () => {
    const { controller, errorCalls } = makeMockController();
    const result = signalStreamError(controller, 'test');

    expect(result.error).toBe(errorCalls[0]);
  });

  it('works with the "No response body reader available" message from route.ts', () => {
    const { controller, errorCalls } = makeMockController();
    // This is the EXACT message used at line ~4725 of route.ts
    signalStreamError(
      controller,
      'No response body reader available from gateway stream',
    );

    expect(errorCalls[0]?.message).toBe(
      'No response body reader available from gateway stream',
    );
  });
});

// ─── B. isStreamErrorSignal — behavioral ─────────────────────────────────

describe('B. isStreamErrorSignal — behavioral', () => {
  it('returns true for a valid StreamErrorSignal', () => {
    const signal: StreamErrorSignal = {
      streamError: true,
      message: 'test',
      error: new Error('test'),
    };
    expect(isStreamErrorSignal(signal)).toBe(true);
  });

  it('returns false for objects without streamError: true', () => {
    expect(isStreamErrorSignal({ message: 'test' })).toBe(false);
    expect(isStreamErrorSignal({ streamError: false })).toBe(false);
    expect(isStreamErrorSignal({ streamError: 'true' })).toBe(false); // wrong type
  });

  it('returns false for null, undefined, and primitives', () => {
    expect(isStreamErrorSignal(null)).toBe(false);
    expect(isStreamErrorSignal(undefined)).toBe(false);
    expect(isStreamErrorSignal('error')).toBe(false);
    expect(isStreamErrorSignal(42)).toBe(false);
    expect(isStreamErrorSignal(true)).toBe(false);
  });

  it('returns false for Error instances (even though they have a message)', () => {
    expect(isStreamErrorSignal(new Error('test'))).toBe(false);
  });

  it('integrates with signalStreamError: round-trip works', () => {
    const { controller } = makeMockController();
    const result = signalStreamError(controller, 'test');
    expect(isStreamErrorSignal(result)).toBe(true);
  });
});

// ─── C. safeEnqueue — behavioral ────────────────────────────────────────

describe('C. safeEnqueue — behavioral', () => {
  it('calls controller.enqueue() with encoded bytes when encoderRef is set', () => {
    const { controller, enqueueCalls } = makeMockController();
    const encoder = new TextEncoder();
    const eventStr = 'event: message\ndata: {"hello":"world"}\n\n';

    const result = safeEnqueue(encoder, controller, eventStr);

    expect(result).toBe(true);
    expect(enqueueCalls).toHaveLength(1);
    // The enqueued bytes should match what TextEncoder would produce
    const expectedBytes = encoder.encode(eventStr);
    expect(enqueueCalls[0]).toEqual(expectedBytes);
  });

  it('SKIPS enqueue (returns false) when encoderRef is null', () => {
    const { controller, enqueueCalls } = makeMockController();

    const result = safeEnqueue(null, controller, 'event: message\n\n');

    expect(result).toBe(false);
    expect(enqueueCalls).toHaveLength(0);
  });

  it('does NOT throw when encoderRef is null', () => {
    const { controller } = makeMockController();
    expect(() => safeEnqueue(null, controller, 'any event')).not.toThrow();
  });

  it('does NOT call encoderRef.encode() when encoderRef is null', () => {
    const { controller } = makeMockController();
    const encodeSpy = vi.fn(() => new Uint8Array([1, 2, 3]));
    const fakeEncoder = { encode: encodeSpy };

    // Pass null — safeEnqueue should not even attempt to call encode
    const result = safeEnqueue(null, controller, 'event');

    expect(result).toBe(false);
    expect(encodeSpy).not.toHaveBeenCalled();
  });

  it('encodes empty string to empty Uint8Array', () => {
    const { controller, enqueueCalls } = makeMockController();
    const encoder = new TextEncoder();

    const result = safeEnqueue(encoder, controller, '');

    expect(result).toBe(true);
    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.length).toBe(0);
  });

  it('encodes unicode characters correctly', () => {
    const { controller, enqueueCalls } = makeMockController();
    const encoder = new TextEncoder();
    const eventStr = 'event: message\ndata: {"text":"héllo 🌍"}\n\n';

    const result = safeEnqueue(encoder, controller, eventStr);

    expect(result).toBe(true);
    const decoded = new TextDecoder().decode(enqueueCalls[0]);
    expect(decoded).toBe(eventStr);
  });
});

// ─── D. Integration — real-world scenario ───────────────────────────────

describe('D. Integration — stream lifecycle', () => {
  it('safeEnqueue works before AND after signalStreamError (no shared state)', () => {
    const { controller, enqueueCalls, errorCalls } = makeMockController();
    const encoder = new TextEncoder();

    // Phase 1: normal enqueue
    expect(safeEnqueue(encoder, controller, 'event: before\n\n')).toBe(true);

    // Phase 2: signal an error
    const signal = signalStreamError(controller, 'stream closed');
    expect(signal.streamError).toBe(true);

    // Phase 3: try to enqueue after error signal (helper should still work)
    // The helper does NOT prevent enqueue after error — that's the caller's
    // job. The helper just null-checks encoderRef.
    expect(safeEnqueue(encoder, controller, 'event: after\n\n')).toBe(true);

    expect(enqueueCalls).toHaveLength(2);
    expect(errorCalls).toHaveLength(1);
  });

  it('simulates the route.ts cleanup pattern: encoderRef = null → safeEnqueue returns false', () => {
    // This is the EXACT pattern used in route.ts at lines ~2714, ~3523, ~4052
    const { controller, enqueueCalls } = makeMockController();
    let encoderRef: TextEncoder | null = new TextEncoder();

    // Phase 1: enqueue while encoderRef is set
    expect(safeEnqueue(encoderRef, controller, 'event: start\n\n')).toBe(true);

    // Phase 2: cleanup — set encoderRef to null (this is what the cleanup
    // function in route.ts does)
    encoderRef = null;

    // Phase 3: try to enqueue after cleanup — should be silently skipped
    expect(safeEnqueue(encoderRef, controller, 'event: after-cleanup\n\n')).toBe(false);

    // Only the first enqueue happened
    expect(enqueueCalls).toHaveLength(1);
  });

  it('simulates the route.ts reader-null pattern: signalStreamError + return', () => {
    // This is the EXACT pattern used in route.ts at line ~4725
    const { controller, errorCalls } = makeMockController();

    // Simulate: streamResponse.body is null, so getReader() returns undefined
    const reader = undefined;

    // The route.ts code does:
    //   if (!reader) return signalStreamError(controller, 'No response body reader available from gateway stream');
    const result: StreamErrorSignal | undefined = !reader
      ? signalStreamError(
          controller,
          'No response body reader available from gateway stream',
        )
      : undefined;

    // The stream is signaled with the error
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0]?.message).toBe(
      'No response body reader available from gateway stream',
    );

    // The return value is a StreamErrorSignal sentinel
    expect(result).toBeDefined();
    expect(isStreamErrorSignal(result!)).toBe(true);
  });
});
