/**
 * Bug #113 (Pass-8) regression tests: wireMissingRequiredArgsSteer
 *
 * The audit's #113 fix direction: when the LLM repeatedly calls tools with
 * missing required arguments, surfacing a [STEER] hint that NAMES the exact
 * missing fields so the model can self-correct on the next turn.
 *
 * Locks down:
 *   1. The `[SYSTEM STEER]` prefix + naming of every missing field.
 *   2. The empty-input short-circuits (empty missingFields, empty toolName) —
 *      caller distinguishes "no validator fire" from "validator fired, all
 *      fields present".
 *   3. The optional `availableFields` block (lists valid field names).
 *   4. The optional `schemaHint` appendix.
 *   5. The metric integration — records under the existing
 *      `missing_tool_call` bucket so dashboards count it.
 *   6. Never throws when `steerMetrics.recordFire` misbehaves.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  wireMissingRequiredArgsSteer,
  steerMetrics,
} from '@/lib/orchestra/steer-service';

describe('Bug #113: wireMissingRequiredArgsSteer', () => {
  beforeEach(() => {
    // Reset metric counters so each test is independent.
    steerMetrics.reset();
  });

  it('returns null-equivalent empty string when missingFields is empty (no validator fire)', () => {
    expect(
      wireMissingRequiredArgsSteer({
        toolName: 'file.write',
        missingFields: [],
      }),
    ).toBe('');
  });

  it('returns empty string when toolName is empty (defensive guard)', () => {
    expect(
      wireMissingRequiredArgsSteer({
        toolName: '',
        missingFields: ['path', 'content'],
      }),
    ).toBe('');
  });

  it('prefixes the prompt with [STEER] (codebase convention; Bug #69 round-2 polish canonicalized this prefix)', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
    });
    expect(prompt).toMatch(/^\[STEER\]/);
  });

  it('NAMES the exact missing fields (the headline audit ask)', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path', 'content'],
    });
    expect(prompt).toContain('"file.write"');
    expect(prompt).toContain('path, content');
  });

  it('handles a single missing field without trailing comma', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'search.files',
      missingFields: ['query'],
    });
    expect(prompt).toContain('query');
    expect(prompt).not.toMatch(/,\s*\.|\s*,$/); // no dangling comma
  });

  it('appends Available fields section when availableFields is provided', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
      availableFields: ['path', 'content', 'mode'],
    });
    expect(prompt).toContain('Available fields for file.write: path, content, mode');
  });

  it('omits Available fields section when availableFields is empty or absent', () => {
    const empty = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
      availableFields: [],
    });
    const absent = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
    });
    expect(empty).not.toContain('Available fields');
    expect(absent).not.toContain('Available fields');
  });

  it('appends schemaHint verbatim when provided', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
      schemaHint: 'path must start with "workspace/sessions/<id>/".',
    });
    expect(prompt).toContain('path must start with');
  });

  it('tells the LLM NOT to retry without filling fields (canonical audit ask)', () => {
    const prompt = wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
    });
    expect(prompt.toLowerCase()).toMatch(/do not retry|fill/);
  });

  it('records the fire in steerMetrics under missing_tool_call bucket (audit-friendly)', () => {
    expect(steerMetrics.countOf('missing_tool_call')).toBe(0);
    wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
    });
    expect(steerMetrics.countOf('missing_tool_call')).toBe(1);
  });

  it('multiple invocations increment the metric each time', () => {
    wireMissingRequiredArgsSteer({
      toolName: 'file.write',
      missingFields: ['path'],
    });
    wireMissingRequiredArgsSteer({
      toolName: 'search.files',
      missingFields: ['query', 'path'],
    });
    wireMissingRequiredArgsSteer({
      toolName: 'bash',
      missingFields: ['command'],
    });
    expect(steerMetrics.countOf('missing_tool_call')).toBe(3);
  });

  it('short-circuited (empty) calls do NOT increment the metric', () => {
    wireMissingRequiredArgsSteer({ toolName: 'a', missingFields: [] });
    wireMissingRequiredArgsSteer({ toolName: '', missingFields: ['x'] });
    expect(steerMetrics.countOf('missing_tool_call')).toBe(0);
  });
});

describe('Bug #113: helper never throws on malformed input', () => {
  it('does not throw when missingFields contains a non-string element', () => {
    // Cast the array to `any` so TS allows the malformed input.
    expect(() =>
      wireMissingRequiredArgsSteer({
        toolName: 'file.write',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        missingFields: [null as any, undefined as any, 42 as any],
      }),
    ).not.toThrow();
  });

  it('does not throw when missingFields is null/undefined', () => {
    expect(() =>
      wireMissingRequiredArgsSteer({
        toolName: 'file.write',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        missingFields: null as any,
      }),
    ).not.toThrow();
    expect(() =>
      wireMissingRequiredArgsSteer({
        toolName: 'file.write',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        missingFields: undefined as any,
      }),
    ).not.toThrow();
  });
});
