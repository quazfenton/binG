/**
 * Stream Safety Helpers
 *
 * PURPOSE: Extract the inline stream-error and encoder-enqueue logic from
 * `bing/web/app/api/chat/route.ts` into pure, testable helper functions.
 * The route.ts file is 5,800+ lines and the inline logic was not unit-
 * testable; these helpers are the test seam.
 *
 * FUNCTIONS:
 *   - `signalStreamError(controller, message)` — calls `controller.error(new Error(message))`
 *     and returns a sentinel object indicating the stream should be closed.
 *     The caller is responsible for `return`ing after the sentinel.
 *   - `safeEnqueue(encoderRef, controller, eventStr)` — null-checks encoderRef
 *     before calling `controller.enqueue(encoderRef.encode(eventStr))`.
 *     Returns `true` if the enqueue happened, `false` if it was skipped.
 *
 * USAGE in route.ts (future PR — not in this PR):
 *   - Replace the inline `controller.error(new Error(...))` + `return` pattern
 *     with `return signalStreamError(controller, '...')` at line ~4725
 *   - Replace the 3 inline `if (encoderRef) controller.enqueue(encoderRef.encode(...))`
 *     patterns with `safeEnqueue(encoderRef, controller, eventStr)` at lines ~2657, ~3509, ~4078
 *
 * SAFETY: These helpers are PURE functions. They do not call any LLM, do not
 * mutate state outside the passed-in controller, and do not throw. The caller
 * is responsible for the `return` statement after `signalStreamError` and
 * for any cleanup logic after `safeEnqueue`.
 */

/**
 * Sentinel object returned by `signalStreamError` to indicate the stream
 * should be closed. The caller should `return` immediately after receiving
 * this sentinel.
 */
export interface StreamErrorSignal {
  /** Discriminator — always true for this interface. */
  readonly streamError: true;
  /** The error message that was signaled. */
  readonly message: string;
  /** The Error instance that was passed to `controller.error()`. */
  readonly error: Error;
}

/**
 * Signal a stream error via `controller.error()` and return a sentinel
 * indicating the stream should be closed.
 *
 * This replaces the inline pattern:
 *   `if (!reader) {`
 *   `  controller.error(new Error('No response body reader available'));`
 *   `  return;`
 *   `}`
 *
 * Usage:
 *   `if (!reader) return signalStreamError(controller, 'No response body reader available');`
 *
 * @param controller - The ReadableStreamDefaultController to signal the error on
 * @param message - The error message
 * @returns A `StreamErrorSignal` sentinel — the caller should `return` it
 *   immediately so the stream is closed cleanly
 */
export function signalStreamError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  message: string,
): StreamErrorSignal {
  const error = new Error(message);
  controller.error(error);
  return { streamError: true, message, error };
}

/**
 * Type guard for `StreamErrorSignal` — useful when the caller stores the
 * return value of a function that may signal a stream error.
 *
 * Usage:
 *   `const result = signalStreamError(controller, '...');`
 *   `if (isStreamErrorSignal(result)) return result;`
 */
export function isStreamErrorSignal(value: unknown): value is StreamErrorSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { streamError?: unknown }).streamError === true
  );
}

/**
 * Null-checked wrapper around `controller.enqueue(encoderRef.encode(eventStr))`.
 *
 * This replaces the inline pattern:
 *   `if (encoderRef) controller.enqueue(encoderRef.encode(eventStr));`
 *
 * Usage:
 *   `safeEnqueue(encoderRef, controller, eventStr);`
 *
 * SAFETY: If `encoderRef` is null (e.g. after the cleanup function set it
 * to null), the enqueue is silently skipped — no throw, no warning. This
 * matches the original inline behavior.
 *
 * @param encoderRef - The TextEncoder (or null after cleanup)
 * @param controller - The ReadableStreamDefaultController to enqueue to
 * @param eventStr - The string to encode and enqueue
 * @returns `true` if the enqueue happened, `false` if it was skipped due
 *   to a null encoderRef
 */
export function safeEnqueue(
  encoderRef: TextEncoder | null,
  controller: ReadableStreamDefaultController<Uint8Array>,
  eventStr: string,
): boolean {
  if (encoderRef === null) {
    return false;
  }
  controller.enqueue(encoderRef.encode(eventStr));
  return true;
}
