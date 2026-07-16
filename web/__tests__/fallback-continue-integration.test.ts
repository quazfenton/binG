import { describe, it, expect } from 'vitest';
import { coordinateConcurrentFallback } from '@/lib/chat/llm-fallback-coordinator';

// Helper to create a stream handle from an async generator function
function makeHandleFromGen<T>(genFn: () => AsyncGenerator<T>, abortFn?: () => void) {
  const gen = genFn();
  return {
    gen,
    abort: abortFn || (() => { if (typeof gen.return === 'function') gen.return(); }),
  };
}

describe('LLM fallback coordinator - fallback-continue integration', () => {
  it('continues on next provider when first fallback errors (rate-limit) during continuation', async () => {
    const primaryProvider = 'primary-mocked';
    const model = 'm-mock';

    // Primary: never yields (silent) - will trigger silence timeout
    const createPrimaryStream = async () => makeHandleFromGen(async function* () {
      // hang indefinitely: never yield
      await new Promise(() => {});
      return;
    });

    // Fallback chain: first provider errors immediately (rate-limit), second yields a chunk
    const createFallbackStream = async (provider: string) => {
      if (provider === 'fb-error') {
        return makeHandleFromGen(async function* () {
          // Simulate error on first next()
          throw new Error('429 Too Many Requests: rate limit');
        });
      }
      if (provider === 'fb-ok') {
        return makeHandleFromGen(async function* () {
          yield { text: 'continued from fb-ok' } as any;
          return;
        });
      }
      // default: no-op
      return makeHandleFromGen(async function* () { return; });
    };

    const chunks: any[] = [];

    const gen = coordinateConcurrentFallback({
      primaryProvider,
      model,
      createPrimaryStream,
      createFallbackStream,
      // Provide explicit short timeouts so the test runs quickly
      silenceMs: 50,
      hardDeadlineMs: 200,
      fallbackChain: ['fb-error', 'fb-ok'],
      requestId: 'test-fallback-continue',
      onFallbackWin: () => {},
      onLoser: () => {},
    });

    for await (const c of gen) {
      chunks.push(c);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(String(chunks[0].text || chunks[0])).toContain('continued from fb-ok');
  });
});
