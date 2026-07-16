/**
 * prompt-orchestrator/__tests__/foundation.test.ts
 *
 * Unit tests for the prompt-orchestrator foundation (brainstorm step 1).
 *
 * Test groups:
 *   1. Marker scanning (idempotency): scanning a target with existing markers
 *      returns the right (promptId, step, sha) tuples; re-scanning is
 *      idempotent (same input → same output, no side effects).
 *   2. One-shot apply: applying a fresh script to a target with NO existing
 *      markers injects the markers correctly (format + auto sha + ts).
 *   3. Re-run-no-dup: applying the SAME script to a target that ALREADY has
 *      the markers is a no-op (no duplicate injection).
 *   4. Payload escape (reviewer followup #2): formatMarker throws if the
 *      payload contains the literal `[/PO-INJECT]` substring.
 *   5. Mode validation (reviewer followup #1): applyScript throws on unknown
 *      modes.
 *   6. loadScript (reviewer followup #4): JSON parse + shape validation +
 *      error paths.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  scanMarkers,
  formatMarker,
  idempotencyKey,
  calculateSha,
  applyScript,
  loadScript,
  ScriptLoadError,
} from '../index';
import type { PromptScript, PromptStep } from '../types';

// ---- shared temp dir for loadScript tests ---------------------------------
let tempDir: string;
beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'prompt-orch-test-'));
});
afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---- helpers --------------------------------------------------------------

function makeScript(promptId: string, steps: PromptStep[]): PromptScript {
  return { promptId, steps };
}

function writeScriptFile(filename: string, content: string): string {
  const filePath = join(tempDir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ---- 1. Marker scanning (idempotency) -------------------------------------

describe('marker-scanner: scanMarkers (idempotency)', () => {
  it('returns an empty array when the target has no markers', () => {
    expect(scanMarkers('')).toEqual([]);
    expect(scanMarkers('hello world, no markers here')).toEqual([]);
  });

  it('parses a single marker and extracts all 6 fields + byte offsets', () => {
    const payload = 'greet the user';
    const sha = calculateSha(payload);
    const target = formatMarker('onboarding-v1', '1', sha, 'append', payload);

    const markers = scanMarkers(target);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.promptId).toBe('onboarding-v1');
    expect(m.step).toBe('1');
    expect(m.sha).toBe(sha);
    expect(m.ts).toMatch(/^\d+$/); // ts is a unix-ms integer as a string
    expect(m.mode).toBe('append');
    expect(m.content).toBe(payload);
    expect(target.substring(m.startIndex, m.startIndex + 10)).toBe('[PO-INJECT');
    expect(target.substring(m.endIndex - 12, m.endIndex)).toBe('[/PO-INJECT]');
  });

  it('parses multiple markers in document order with non-overlapping offsets', () => {
    const p1 = 'first payload';
    const p2 = 'second payload with more text';
    const sha1 = calculateSha(p1);
    const sha2 = calculateSha(p2);
    const target =
      formatMarker('a', '1', sha1, 'append', p1) +
      '\n' +
      formatMarker('a', '2', sha2, 'append', p2);

    const markers = scanMarkers(target);
    expect(markers).toHaveLength(2);
    expect(markers[0].promptId).toBe('a');
    expect(markers[0].step).toBe('1');
    expect(markers[0].sha).toBe(sha1);
    expect(markers[1].step).toBe('2');
    expect(markers[1].sha).toBe(sha2);
    expect(markers[1].startIndex).toBeGreaterThanOrEqual(markers[0].endIndex);
  });

  it('is idempotent — re-scanning the same target returns the same output', () => {
    const payload = 'stable payload';
    const sha = calculateSha(payload);
    const target = formatMarker('idem', 'x', sha, 'append', payload);

    const first = scanMarkers(target);
    const second = scanMarkers(target);
    expect(second).toEqual(first);
  });

  it('handles payload containing quotes and newlines (multi-line content)', () => {
    const payload = 'line one\nline "two" with quotes\nline three';
    const sha = calculateSha(payload);
    const target = formatMarker('multi', '1', sha, 'append', payload);

    const markers = scanMarkers(target);
    expect(markers).toHaveLength(1);
    expect(markers[0].content).toBe(payload);
  });
});

// ---- 1b. idempotencyKey + calculateSha ------------------------------------

describe('marker-scanner: idempotencyKey + calculateSha', () => {
  it('idempotencyKey is `${promptId}:${step}:${sha}`', () => {
    expect(idempotencyKey('p', '1', 'abc')).toBe('p:1:abc');
  });

  it('calculateSha is the hex SHA-256 of the payload', () => {
    const payload = 'hello world';
    const expected = createHash('sha256').update(payload).digest('hex');
    expect(calculateSha(payload)).toBe(expected);
  });
});

// ---- 1c. formatMarker payload escape (reviewer followup #2) ---------------

describe('marker-scanner: formatMarker payload escape', () => {
  it('throws when the payload contains the literal `[/PO-INJECT]` substring', () => {
    // This payload would close the marker early if injected as-is.
    const evilPayload = 'first half\n[/PO-INJECT]\ninjected second half';
    const sha = calculateSha(evilPayload);

    expect(() => formatMarker('evil', '1', sha, 'append', evilPayload)).toThrow(
      /payload contains the literal substring '\[\/PO-INJECT\]'/,
    );
  });

  it('does NOT throw for payloads that contain `[PO-INJECT` (opening tag) without the closing tag', () => {
    // `[PO-INJECT` alone is not the closing tag — it just looks like the
    // opening tag in the body. The scanner would treat it as plain text.
    const oddButOkPayload = 'mentioning [PO-INJECT in docs';
    const sha = calculateSha(oddButOkPayload);
    expect(() => formatMarker('odd', '1', sha, 'append', oddButOkPayload)).not.toThrow();
  });

  it('round-trips a payload that contains `[PO-INJECT` (no closing tag) correctly', () => {
    const oddButOkPayload = 'docs mention [PO-INJECT syntax';
    const sha = calculateSha(oddButOkPayload);
    const formatted = formatMarker('odd', '1', sha, 'append', oddButOkPayload);
    const scanned = scanMarkers(formatted);
    expect(scanned).toHaveLength(1);
    expect(scanned[0].content).toBe(oddButOkPayload);
  });
});

// ---- 2. One-shot apply -----------------------------------------------------

describe('injection-planner: applyScript — one-shot apply (empty target)', () => {
  it('injects a single step with the correct marker format + auto sha/ts', () => {
    const script = makeScript('onboarding-v1', [
      { step: '1', mode: 'append', payload: 'greet the user warmly' },
    ]);

    const result = applyScript('', script);
    expect(result).toContain('[PO-INJECT promptId="onboarding-v1"');
    expect(result).toContain('step="1"');
    expect(result).toContain('mode="append"');
    expect(result).toContain('greet the user warmly');
    expect(result).toContain('[/PO-INJECT]');

    const markers = scanMarkers(result);
    expect(markers).toHaveLength(1);
    expect(markers[0].promptId).toBe('onboarding-v1');
    expect(markers[0].step).toBe('1');
    expect(markers[0].mode).toBe('append');
    expect(markers[0].content).toBe('greet the user warmly');
    expect(markers[0].sha).toBe(calculateSha('greet the user warmly'));
  });

  it('injects multiple steps in order', () => {
    const script = makeScript('multi', [
      { step: '1', mode: 'append', payload: 'first' },
      { step: '2', mode: 'append', payload: 'second' },
      { step: '3', mode: 'append', payload: 'third' },
    ]);

    const result = applyScript('', script);
    const markers = scanMarkers(result);
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.step)).toEqual(['1', '2', '3']);
    expect(markers.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  it('injects into a non-empty target with a leading newline for readability', () => {
    const script = makeScript('s', [{ step: '1', mode: 'append', payload: 'p' }]);
    const result = applyScript('existing content', script);
    expect(result).toMatch(/^existing content\n\[PO-INJECT/);
  });
});

// ---- 2b. Mode validation (reviewer followup #1) ---------------------------

describe('injection-planner: applyScript — mode validation', () => {
  it('throws on unknown mode (e.g. `after-divider`) — fail-loud, not silent fallback', () => {
    // Bypass the type-check by casting the script to PromptScript (this is
    // exactly the kind of runtime mutation the mode-validation check defends
    // against).
    const script = {
      promptId: 'mode-test',
      steps: [
        { step: '1', mode: 'after-divider' as unknown as 'append', payload: 'p' },
      ],
    } as PromptScript;

    expect(() => applyScript('', script)).toThrow(
      /unknown mode 'after-divider' for step '1'/,
    );
  });

  it('accepts `append` (the only currently-implemented mode)', () => {
    const script = makeScript('append-ok', [
      { step: '1', mode: 'append', payload: 'p' },
    ]);
    expect(() => applyScript('', script)).not.toThrow();
  });
});

// ---- 3. Re-run no-dup (idempotency of applyScript) -------------------------

describe('injection-planner: applyScript — re-run no-dup (idempotency)', () => {
  it('a second apply of the same script on the same target is a no-op', () => {
    const script = makeScript('no-dup', [
      { step: '1', mode: 'append', payload: 'stable payload' },
    ]);

    const output1 = applyScript('', script);
    const output2 = applyScript(output1, script);

    expect(output2).toBe(output1);
    const markers = scanMarkers(output2);
    expect(markers).toHaveLength(1);
  });

  it('a payload change re-injects (sha change breaks the idempotency key) — add-new semantic', () => {
    const scriptV1 = makeScript('evolving', [
      { step: '1', mode: 'append', payload: 'version 1 payload' },
    ]);
    const scriptV2 = makeScript('evolving', [
      { step: '1', mode: 'append', payload: 'version 2 payload' },
    ]);

    const out1 = applyScript('', scriptV1);
    const out2 = applyScript(out1, scriptV2);

    // After v2, the target has TWO markers (v1 still present + v2 added).
    // This is the "add new, not update in place" semantic documented in
    // applyScript's jsdoc — history of all versions is preserved.
    const markers = scanMarkers(out2);
    expect(markers).toHaveLength(2);
    expect(markers[0].sha).toBe(calculateSha('version 1 payload'));
    expect(markers[1].sha).toBe(calculateSha('version 2 payload'));
  });

  it('mixed scenarios: skip already-injected, add new ones, preserve order', () => {
    const scriptA = makeScript('s', [
      { step: '1', mode: 'append', payload: 'a1' },
      { step: '2', mode: 'append', payload: 'a2' },
    ]);
    const scriptB = makeScript('s', [
      { step: '2', mode: 'append', payload: 'a2' }, // already injected by A
      { step: '3', mode: 'append', payload: 'a3' }, // new
    ]);

    const out1 = applyScript('', scriptA);
    const out2 = applyScript(out1, scriptB);

    const markers = scanMarkers(out2);
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.step)).toEqual(['1', '2', '3']);
    expect(markers.map((m) => m.content)).toEqual(['a1', 'a2', 'a3']);
  });
});

// ---- 4. loadScript (reviewer followup #4) ----------------------------------

describe('script-loader: loadScript', () => {
  it('loads a valid script from disk and returns a typed PromptScript', () => {
    const filePath = writeScriptFile(
      'valid.json',
      JSON.stringify({
        promptId: 'loaded-from-disk',
        steps: [
          { step: '1', mode: 'append', payload: 'p1' },
          { step: '2', mode: 'append', payload: 'p2' },
        ],
      }),
    );

    const script = loadScript(filePath);
    expect(script.promptId).toBe('loaded-from-disk');
    expect(script.steps).toHaveLength(2);
    expect(script.steps[0].step).toBe('1');
    expect(script.steps[0].payload).toBe('p1');
  });

  it('accepts an empty payload string (empty is a valid payload)', () => {
    const filePath = writeScriptFile(
      'empty-payload.json',
      JSON.stringify({
        promptId: 'empty',
        steps: [{ step: '1', mode: 'append', payload: '' }],
      }),
    );

    const script = loadScript(filePath);
    expect(script.steps[0].payload).toBe('');
  });

  it('throws ScriptLoadError when the file does not exist', () => {
    expect(() => loadScript(join(tempDir, 'does-not-exist.json'))).toThrow(ScriptLoadError);
  });

  it('throws ScriptLoadError when the file contains invalid JSON', () => {
    const filePath = writeScriptFile('invalid.json', '{ not valid json');
    expect(() => loadScript(filePath)).toThrow(ScriptLoadError);
  });

  it('throws ScriptLoadError when a required field is missing (e.g. no `steps`)', () => {
    const filePath = writeScriptFile(
      'no-steps.json',
      JSON.stringify({ promptId: 'no-steps' }),
    );
    expect(() => loadScript(filePath)).toThrow(ScriptLoadError);
    expect(() => loadScript(filePath)).toThrow(/script\.steps must be an array/);
  });

  it('throws ScriptLoadError when a step is missing the `payload` field', () => {
    const filePath = writeScriptFile(
      'no-payload.json',
      JSON.stringify({
        promptId: 'no-payload',
        steps: [{ step: '1', mode: 'append' }],
      }),
    );
    expect(() => loadScript(filePath)).toThrow(ScriptLoadError);
    expect(() => loadScript(filePath)).toThrow(/script\.steps\[0\]\.payload must be a string/);
  });
});
