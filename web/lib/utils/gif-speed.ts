/**
 * GIF speed modifier — adjusts frame delays by a speed factor.
 *
 * Scans the raw GIF bytes for Graphics Control Extension blocks
 * and multiplies each frame's delay (in hundredths of seconds)
 * by the given speed factor. A factor of 1 leaves delays unchanged.
 *
 * Works without any GIF parsing library — just binary pattern matching.
 */

const MIN_DELAY = 1;  // 10 ms — GIF spec minimum; 0 would mean "use renderer default"

export function modifyGifSpeed(arrayBuffer: ArrayBuffer, speed: number): ArrayBuffer {
  // Clamp speed to a sane range — 0.01x to 100x
  const clampedSpeed = Math.max(0.01, Math.min(100, speed));

  if (clampedSpeed === 1) {
    // No-op: return the original buffer
    return arrayBuffer;
  }

  const data = new Uint8Array(arrayBuffer);
  const result = new Uint8Array(data.length);
  result.set(data);

  for (let i = 0; i < result.length - 8; i++) {
    // Graphics Control Extension: 0x21 0xF9 0x04
    if (result[i] === 0x21 && result[i + 1] === 0xF9 && result[i + 2] === 0x04) {
      const delayLo = result[i + 4];
      const delayHi = result[i + 5];
      const delay = delayLo | (delayHi << 8);

      // Skip delays of 0 or 1 — these are effectively "as fast as possible"
      // and multiplying them would only yield tiny sub-10ms values.
      if (delay > MIN_DELAY) {
        let newDelay = Math.max(MIN_DELAY, Math.round(delay / clampedSpeed));
        newDelay = Math.min(newDelay, 0xFFFF);

        result[i + 4] = newDelay & 0xFF;
        result[i + 5] = (newDelay >> 8) & 0xFF;
      }
    }
  }

  return result.buffer as ArrayBuffer;
}
