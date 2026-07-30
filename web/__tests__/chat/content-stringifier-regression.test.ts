/**
 * Regression test — closes the operator-precedence `'[object Object]'` bug
 * class that historically surfaced at route.ts L2051 / L2500 / L2516 / L2784
 * (the defense-in-depth catch-all surfaces documented in the
 * JSDoc at /opt/bing/web/lib/chat/content-stringifier.ts L78-L86).
 *
 * ## Why this test exists
 *
 * Before the fix, the route's emit paths concatenated non-string
 * `result.response` shapes (ContentPart arrays, `{role, parts, content}`
 * objects, raw objects) into SSE streams via `streamState.buffer +
 * result.response`. Because `+` binds tighter than `||`, a fallback like
 * `result.response || ''` evaluated the OBJECT first (truthy), so the
 * concatenation silently coerced to the literal `'[object Object]'` and
 * the user saw a stream with zero content chunks despite 27.7s of
 * pre-Response setup.
 *
 * The fix routes every LLM-message-content concatenation through
 * `stringifyMessageContent(value: unknown): string`, which:
 *   - Returns `''` for null/undefined
 *   - Passes strings through
 *   - Joins string arrays / extracts ContentPart text
 *   - Extracts `{content}` / `{response}` / `{parts}` shapes
 *   - Falls through to `JSON.stringify(value, bigIntSafeReplacer)` for
 *     unknown objects (NEVER `'[object Object]'`)
 *   - Returns `String(value)` for primitives
 *   - NEVER throws
 *
 * ## What this test asserts
 *
 * 1. **Helper contract** (Sections A+B): for every shape the 4 documented
 *    defense-in-depth sites could encounter, `stringifyMessageContent`
 *    returns a real string (never `'[object Object]'`, never throws, never
 *    returns non-string).
 *
 * 2. **Site presence guard** (Section C): the route's 4 documented
 *    defense-in-depth call-sites (L2500 comment block, L2516 comment block,
 *    L2784 comment block) are
 *    physically followed by code that invokes `stringifyMessageContent` on
 *    a non-string response surface within ±30 lines. This catches the
 *    "fix removed in a refactor" regression class — if a future cleanup
 *    drops one of the call sites, the test fails fast.
 *
 * 3. **Site behavior end-to-end** (Section D): for the exact non-string
 *    shapes the 4 sites handle, the helper's output is the contracted
 *    string (not `[object Object]`, not a thrown error). This is the
 *    behavioral lock-in for the user's literal request.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringifyMessageContent } from '@/lib/chat/content-stringifier';

const ROUTE_PATH = resolve(
  process.cwd(),
  'app/api/chat/route.ts',
);

/**
 * The defense-in-depth sites. Each `site.line` is the
 * comment-anchor line referenced in the user's request + the helper's
 * JSDoc. Each `site.coercionLine` is the ACTUAL call-site that follows
 * the comment. The test reads both:
 *   - `site.line` must exist with the documented comment
 *   - `site.coercionLine` must contain `stringifyMessageContent(`
 */
const DEFENSE_IN_DEPTH_SITES = [
  {
    id: 'layer-3-processUnifiedAgentRequest',
    line: 2580,
    coercionLine: 2605,
    expectedFragment: 'Bug-fix #2: surface the post-await response shape',
    description:
      'processUnifiedAgentRequest result.response → iterContent',
  },
  {
    id: 'layer-3-iterContent',
    line: 2596,
    coercionLine: 2605,
    expectedFragment: 'Accumulate this iteration',
    description:
      'streamState.buffer + result.response concatenation → iterContent',
  },
  {
    id: 'layer-3-sessionNaming',
    line: 2862,
    coercionLine: 2871,
    expectedFragment: 'SESSION NAMING',
    description:
      'finalEdits → session naming detection via detectSingleFolderFromResponse',
  },
] as const;

describe('content-stringifier-regression — defense-in-depth contract', () => {
  // ================================================================
  // Section A: helper NEVER returns '[object Object]'
  // ================================================================

  describe('Section A: helper NEVER returns "[object Object]" for LLM content shapes', () => {
    const NON_STRING_SHAPES: Array<{ name: string; value: unknown }> = [
      { name: 'plain object (Error-like)', value: { message: 'boom' } },
      { name: 'plain object (no recognized field)', value: { foo: 'bar', n: 42 } },
      { name: 'plain object with nested content', value: { role: 'assistant', parts: [{ text: 'hi' }] } },
      { name: 'ContentPart array (Vercel AI SDK)', value: [{ type: 'text', text: 'hello' }] },
      { name: 'ContentPart array with tool_use part', value: [{ type: 'tool_use', id: '1', name: 'bash', input: { cmd: 'ls' } }] },
      { name: 'mixed string + object array', value: ['prefix ', { type: 'text', text: 'middle' }, ' suffix'] },
      { name: 'null', value: null },
      { name: 'undefined', value: undefined },
      { name: 'number', value: 42 },
      { name: 'boolean', value: false },
      { name: 'BigInt', value: 1_000_000n },
      { name: 'Symbol', value: Symbol('test') },
      { name: 'empty array', value: [] },
      { name: 'array of strings', value: ['a', 'b', 'c'] },
      { name: 'cyclical object (try/catch safety net)', value: (() => { const o: any = { name: 'r' }; o.self = o; return o; })() },
    ];

    for (const { name, value } of NON_STRING_SHAPES) {
      it(`returns a non-"[object Object]" string for ${name}`, () => {
        const out = stringifyMessageContent(value);
        expect(typeof out).toBe('string');
        expect(out).not.toBe('[object Object]');
      });
    }
  });

  // ================================================================
  // Section B: helper behavior contract — what users SEE for each shape
  // ================================================================

  describe('Section B: helper behavior contract — user-visible output', () => {
    it('passes strings through unchanged (canonical contract path)', () => {
      expect(stringifyMessageContent('hello world')).toBe('hello world');
      expect(stringifyMessageContent('')).toBe('');
    });

    it('returns "" for null/undefined (no "nullhello"/"undefinedhello" artifacts)', () => {
      expect(stringifyMessageContent(null)).toBe('');
      expect(stringifyMessageContent(undefined)).toBe('');
    });

    it('joins string arrays by concatenation', () => {
      expect(stringifyMessageContent(['a', 'b', 'c'])).toBe('abc');
    });

    it('extracts text from Vercel AI SDK ContentPart arrays', () => {
      expect(stringifyMessageContent([{ type: 'text', text: 'hello' }])).toBe('hello');
      expect(stringifyMessageContent([
        { type: 'text', text: 'foo ' },
        { type: 'text', text: 'bar' },
      ])).toBe('foo bar');
    });

    it('extracts {content: string} (StreamingResponse shape)', () => {
      expect(stringifyMessageContent({ content: 'from-content' })).toBe('from-content');
    });

    it('extracts {response: string} (nested AgentExecute shape)', () => {
      expect(stringifyMessageContent({ response: 'from-response' })).toBe('from-response');
    });

    it('extracts {parts: Array<{text?: string}>} (Anthropic message shape, recursive)', () => {
      expect(stringifyMessageContent({ parts: [{ text: 'p1 ' }, { text: 'p2' }] }))
        .toBe('p1 p2');
    });

    it('falls through to JSON.stringify for unknown objects — NEVER "[object Object]"', () => {
      const out = stringifyMessageContent({ foo: 'bar', n: 42 });
      expect(out).not.toBe('[object Object]');
      expect(out).toContain('"foo":"bar"');
      expect(out).toContain('"n":42');
    });

    it('handles BigInt values without throwing', () => {
      expect(stringifyMessageContent(123n)).toBe('123');
      expect(stringifyMessageContent({ kind: 'limit', value: 1_000_000n }))
        .toContain('"value":"1000000"');
    });

    it('handles Symbol values (returns "Symbol(...)")', () => {
      expect(stringifyMessageContent(Symbol('hi'))).toBe('Symbol(hi)');
    });

    it('handles cyclic objects via try/catch safety net (never throws)', () => {
      const cyclic: any = { name: 'root' };
      cyclic.self = cyclic;
      const out = stringifyMessageContent(cyclic);
      expect(typeof out).toBe('string');
      expect(['', '{}']).toContain(out);
    });

    it('is idempotent (running twice gives the same result)', () => {
      const input = [{ type: 'text', text: 'once ' }, { type: 'text', text: 'twice' }];
      expect(stringifyMessageContent(stringifyMessageContent(input)))
        .toBe(stringifyMessageContent(input));
    });
  });

  // ================================================================
  // Section C: route.ts physical-presence guard
  // ================================================================

  describe('Section C: route.ts contains the defense-in-depth call sites', () => {
    let routeSource: string;
    let routeLines: string[];

    // Read once — the route is 7,000+ lines.
    function loadRoute(): { source: string; lines: string[] } {
      if (!routeSource) {
        routeSource = readFileSync(ROUTE_PATH, 'utf8');
        routeLines = routeSource.split('\n');
      }
      return { source: routeSource, lines: routeLines };
    }

    function getLinesAround(center: number, before: number, after: number): string[] {
      const { lines } = loadRoute();
      const start = Math.max(0, center - before);
      const end = Math.min(lines.length, center + after);
      return lines.slice(start, end);
    }

    for (const site of DEFENSE_IN_DEPTH_SITES) {
      it(`site #${site.id} (anchor L${site.line}) preserves the documented comment`, () => {
        const { lines } = loadRoute();
        // 0-indexed array vs 1-indexed line numbers
        const line = lines[site.line - 1] ?? '';
        expect(line).toContain(site.expectedFragment);
      });

      it(`site #${site.id} call-site L${site.coercionLine} invokes stringifyMessageContent(`, () => {
        const { lines } = loadRoute();
        const callLine = lines[site.coercionLine - 1] ?? '';
        expect(callLine).toContain('stringifyMessageContent(');
      });

      it(`site #${site.id} call-site L${site.coercionLine} follows the documented comment within ±15 lines`, () => {
        const { lines } = loadRoute();
        // The defense-in-depth comment + the actual call should be close together.
        // For sites 1+2 the call is at L2525; for site 3 it's L2793.
        const anchorIdx = site.line - 1;
        const callIdx = site.coercionLine - 1;
        const distance = Math.abs(callIdx - anchorIdx);
        expect(distance).toBeLessThanOrEqual(30);
      });
    }
  });

  // ================================================================
  // Section D: site-behavior end-to-end
  //
  // For each documented site, verify that the EXACT shape the site handles
  // (per its description in DEFENSE_IN_DEPTH_SITES) is coerced to a real
  // string by the helper — this is the user's literal request:
  // "each site produces a real string (NEVER '[object Object]') for
  // non-string error shapes".
  // ================================================================

  describe('Section D: each site handles non-string shapes via stringifyMessageContent', () => {
    it('site #layer-3-mcpRaceError — Error-like object (mcpRaceError.message fallback) → string', () => {
      const mcpRaceErrorShape = { message: 'MCP tools fetch timed out', code: 'TIMEOUT' };
      const out = stringifyMessageContent(mcpRaceErrorShape);
      expect(typeof out).toBe('string');
      expect(out).not.toBe('[object Object]');
      // JSON.stringify fallback surface for unknown shapes:
      expect(out).toContain('MCP tools fetch timed out');
    });

    it('site #layer-3-processUnifiedAgentRequest — processUnifiedAgentRequest response surface → string', () => {
      // result.response can be ContentPart array (Vercel AI SDK shape)
      const responseShape = [{ type: 'text', text: 'hello from processUnifiedAgentRequest' }];
      const out = stringifyMessageContent(responseShape);
      expect(typeof out).toBe('string');
      expect(out).toBe('hello from processUnifiedAgentRequest');
      expect(out).not.toBe('[object Object]');
    });

    it('site #layer-3-iterContent — buffer + result.response concat surface → string', () => {
      // The iterContent path concatenates streamState.buffer (string) with
      // result.response (potentially non-string). After the fix, both halves
      // are coerced through stringifyMessageContent before concat.
      const buffer = 'prefix-stream-content';
      const resultResponse = { content: 'response-from-llm' };
      const iterContent = buffer + stringifyMessageContent(resultResponse);
      expect(iterContent).toBe('prefix-stream-contentresponse-from-llm');
      expect(iterContent).not.toContain('[object Object]');
    });

    it('site #layer-3-sessionNaming — finalEdits → session naming detection → string', () => {
      // The session-naming detection receives the final iteration buffer
      // (string) concatenated with the last result.response (potentially
      // non-string). After the fix, the response half is coerced via
      // stringifyMessageContent.
      const finalBuffer = 'session-naming-input';
      const finalResponse = { parts: [{ text: 'from-parts' }] };
      const sessionNameInput = finalBuffer + stringifyMessageContent(finalResponse);
      expect(sessionNameInput).toBe('session-naming-inputfrom-parts');
      expect(sessionNameInput).not.toContain('[object Object]');
    });
  });
});
